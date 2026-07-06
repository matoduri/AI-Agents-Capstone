# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
from __future__ import annotations

import asyncio
import base64
import datetime
import json
import os
import re
import sys

from google.adk.agents import LlmAgent
from google.adk.agents.context import Context
from google.adk.apps import App
from google.adk.events.event import Event
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow, node
from google.genai import types
from pydantic import BaseModel, Field

# =====================================================================
# State & Log Schema Definitions
# =====================================================================


class NewbornProfile(BaseModel):
    name: str
    birth_date: str | None = None
    initial_weight: str | None = None
    photo_base64: str | None = None
    unit_system: str | None = None


class FeedingLog(BaseModel):
    type: str  # "breastfeeding", "formula", "solids", "combination"
    amount: float | None = None  # ml for liquids, g for solids
    unit: str | None = None  # "ml" or "g"
    timestamp: str


class DiaperLog(BaseModel):
    type: str  # "wet", "dirty", "both"
    timestamp: str


class WeightLog(BaseModel):
    weight_kg: float
    timestamp: str


class NewbornData(BaseModel):
    profile: NewbornProfile
    feedings: list[FeedingLog] = Field(default_factory=list)
    diapers: list[DiaperLog] = Field(default_factory=list)
    weights: list[WeightLog] = Field(default_factory=list)


class ExtractedFeeding(BaseModel):
    type: str = Field(
        description="The type of feeding. Must be one of: 'breastfeeding', 'formula', 'solids'."
    )
    amount: float = Field(
        description="The numeric amount in METRIC units. For 'breastfeeding' and 'formula': always store in ml (if user said oz, multiply by 29.5735). For 'solids': store in grams exactly as stated."
    )


class ExtractedInfo(BaseModel):
    newborn_name: str | None = Field(
        default=None, description="The name of the newborn mentioned in the message."
    )
    birth_date: str | None = Field(
        default=None,
        description="The birth date of the newborn if mentioned (e.g. 'July 4, 2026').",
    )
    weight: str | None = Field(
        default=None,
        description="The weight of the newborn mentioned (e.g. '7 lbs 8 oz' or '3.4 kg'). Always preserve the original string.",
    )
    feedings: list[ExtractedFeeding] = Field(
        default_factory=list,
        description="List of all feedings mentioned in the message.",
    )
    diaper_type: str | None = Field(
        default=None,
        description="The diaper update type. Must be one of: 'wet', 'dirty', 'both', or None.",
    )
    diaper_wet_count: int | None = Field(
        default=None, description="Wet diaper count if mentioned."
    )
    diaper_dirty_count: int | None = Field(
        default=None, description="Dirty diaper count if mentioned."
    )
    is_new_newborn: bool = Field(
        default=False,
        description="True if parent is explicitly asking to create/track a newborn for the first time.",
    )
    unit_system: str | None = Field(
        default=None,
        description="The preferred unit system of the user extracted from context. Must be 'metric' or 'imperial'.",
    )


class TrackerState(BaseModel):
    newborns: dict[str, NewbornData] = Field(default_factory=dict)
    active_newborn: str | None = None


class WorkflowState(BaseModel):
    tracker_state: TrackerState | None = Field(default_factory=TrackerState)
    extracted_info: ExtractedInfo | None = None


PROFILES_DIR = os.environ.get(
    "PROFILES_DIR",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "baby_profiles",
    ),
)
os.makedirs(PROFILES_DIR, exist_ok=True)


def migrate_old_profiles():
    old_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baby_profiles")
    if os.path.abspath(old_dir) == os.path.abspath(PROFILES_DIR):
        return
    if os.path.exists(old_dir) and os.path.isdir(old_dir):
        if not os.listdir(PROFILES_DIR):
            import shutil

            for fname in os.listdir(old_dir):
                if fname.endswith(".json"):
                    src = os.path.join(old_dir, fname)
                    dst = os.path.join(PROFILES_DIR, fname)
                    try:
                        shutil.copy2(src, dst)
                        print(f"Migrated profile {fname} to {PROFILES_DIR}")
                    except Exception as e:
                        print(f"Failed to migrate profile {fname}: {e}")


migrate_old_profiles()

PHOTOS_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "static", "photos"
)
os.makedirs(PHOTOS_DIR, exist_ok=True)

IS_TEST = "pytest" in sys.modules or "unittest" in sys.modules

_profiles_mtime_cache = {}  # fname -> mtime
_profiles_data_cache = {}  # fname -> NewbornData dict


def extract_and_save_photo(name: str, photo_data: str | None) -> str | None:
    if not photo_data:
        return None
    if photo_data.startswith("/static/"):
        return photo_data

    if "base64," in photo_data:
        try:
            header, base64_str = photo_data.split("base64,", 1)
            ext = "jpg"
            if "png" in header:
                ext = "png"
            elif "gif" in header:
                ext = "gif"
            elif "webp" in header:
                ext = "webp"
            img_bytes = base64.b64decode(base64_str)
        except Exception as e:
            print(f"Error parsing base64 image data: {e}")
            return photo_data
    else:
        try:
            img_bytes = base64.b64decode(photo_data)
            ext = "jpg"
        except Exception:
            return photo_data

    safe_name = name.lower().replace(" ", "_")
    filename = f"{safe_name}.{ext}"
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    file_path = os.path.join(PHOTOS_DIR, filename)
    try:
        with open(file_path, "wb") as f:
            f.write(img_bytes)
        return f"/static/photos/{filename}"
    except Exception as e:
        print(f"Error saving binary photo to disk: {e}")
        return photo_data


def sync_profiles_from_disk(tracker_state: TrackerState):
    """Loads all profiles from baby_profiles directory and merges into tracker_state."""
    if IS_TEST:
        return
    if not os.path.exists(PROFILES_DIR):
        return
    found_keys = set()
    global _profiles_mtime_cache, _profiles_data_cache

    try:
        filenames = os.listdir(PROFILES_DIR)
    except Exception as e:
        print(f"Error listing PROFILES_DIR: {e}")
        return

    for fname in filenames:
        if fname.endswith(".json"):
            key = fname.replace(".json", "").replace("_", " ")
            file_path = os.path.join(PROFILES_DIR, fname)
            try:
                mtime = os.path.getmtime(file_path)
                if (
                    _profiles_mtime_cache.get(fname) == mtime
                    and fname in _profiles_data_cache
                ):
                    newborn_data = NewbornData(**_profiles_data_cache[fname])
                else:
                    with open(file_path) as f:
                        data = json.load(f)

                    # Extract Base64 photo to separate file if needed
                    profile_info = data.get("profile", {})
                    photo_data = profile_info.get("photo_base64")
                    if photo_data and not photo_data.startswith("/static/"):
                        new_url = extract_and_save_photo(key, photo_data)
                        if new_url != photo_data:
                            profile_info["photo_base64"] = new_url
                            try:
                                with open(file_path, "w") as fw:
                                    json.dump(data, fw, indent=2)
                                mtime = os.path.getmtime(file_path)
                            except Exception as write_err:
                                print(
                                    f"Error normalizing file after photo extraction: {write_err}"
                                )

                    newborn_data = NewbornData(**data)
                    _profiles_mtime_cache[fname] = mtime
                    _profiles_data_cache[fname] = newborn_data.model_dump()

                tracker_state.newborns[key] = newborn_data
                found_keys.add(key)
            except Exception as e:
                print(f"Error loading profile {fname}: {e}")

    # Remove any newborns that no longer exist on disk
    for key in list(tracker_state.newborns.keys()):
        if key not in found_keys:
            del tracker_state.newborns[key]

    # Re-evaluate active newborn if current one is deleted
    if (
        tracker_state.active_newborn
        and tracker_state.active_newborn not in tracker_state.newborns
    ):
        if tracker_state.newborns:
            tracker_state.active_newborn = next(iter(tracker_state.newborns.keys()))
        else:
            tracker_state.active_newborn = None


def save_profiles_to_disk(tracker_state: TrackerState):
    """Saves all profiles in tracker_state back to files in baby_profiles directory."""
    if IS_TEST:
        return
    os.makedirs(PROFILES_DIR, exist_ok=True)
    global _profiles_mtime_cache, _profiles_data_cache

    for key, newborn_data in tracker_state.newborns.items():
        filename = key.replace(" ", "_") + ".json"
        file_path = os.path.join(PROFILES_DIR, filename)

        # Ensure base64 photos are saved as binary/URLs
        profile = newborn_data.profile
        if profile.photo_base64 and not profile.photo_base64.startswith("/static/"):
            new_url = extract_and_save_photo(key, profile.photo_base64)
            if new_url != profile.photo_base64:
                profile.photo_base64 = new_url

        dumped_data = newborn_data.model_dump()
        if _profiles_data_cache.get(filename) == dumped_data and os.path.exists(
            file_path
        ):
            continue

        try:
            with open(file_path, "w") as f:
                json.dump(dumped_data, f, indent=2)
            _profiles_mtime_cache[filename] = os.path.getmtime(file_path)
            _profiles_data_cache[filename] = dumped_data
        except Exception as e:
            print(f"Error saving profile {filename}: {e}")


# Extraction LLM Agent
# =====================================================================
extractor = LlmAgent(
    name="extractor",
    model="gemini-2.5-flash",
    instruction="""You are an expert extraction assistant for a newborn tracker app.
Extract any of the following details from the parent's message:
- newborn_name: name of the baby. NEVER extract food ingredients (like breastmilk, formula, solids, milk, water, food) or units (ml, oz, g, kg, lbs) as newborn name. Leave null if no actual human baby name is mentioned.
- birth_date: birth date of the baby.
- weight: weight of the baby — preserve the original string exactly (e.g. '7 lbs 8 oz', '3.4 kg').
- feedings: extract ALL feeding types mentioned in a single list. For each:
  * type: exactly one of 'breastfeeding', 'formula', or 'solids'.
  * amount: the numeric value ALWAYS in metric units:
    - For 'breastfeeding' and 'formula': store in MILLILITRES (ml). If the user said oz, multiply by 29.5735.
    - For 'solids': store in GRAMS exactly as stated.
  Example: '100ml formula, 50ml breastmilk, 10g solids' → feedings: [
    {type:'formula', amount:100.0},
    {type:'breastfeeding', amount:50.0},
    {type:'solids', amount:10.0}
  ]
  Example: '3 oz formula' → feedings: [{type:'formula', amount:88.72}]
- diaper_type: 'wet', 'dirty', or 'both' if diaper status is mentioned.
- diaper_wet_count / diaper_dirty_count: counts of diapers if mentioned.
- is_new_newborn: True if user explicitly wants to create a new baby profile (e.g., 'create a profile for Leo'). Do NOT set to True for regular logs.
- unit_system: REQUIRED - always read from [System Context] line and set to 'metric' or 'imperial'.

Do not guess. Leave non-feeding fields null if not mentioned. Never omit a feeding type that was mentioned.""",
    output_schema=ExtractedInfo,
    output_key="extracted_info",
)


# =====================================================================
# Graph Function Nodes
# =====================================================================


def _get_string_from_resume_input(val) -> str:
    if isinstance(val, dict):
        res = val.get("output") or val.get("response") or val.get("text")
        if res is not None:
            return str(res).strip()
        if val:
            return str(next(iter(val.values()))).strip()
        return ""
    return str(val).strip()


def parse_weight_to_lbs(weight_str: str | None) -> float:
    if not weight_str:
        return 0.0
    clean_str = weight_str.lower().strip()

    # Check for lbs and oz combination
    if "lbs" in clean_str or "lb" in clean_str:
        parts = re.split(r"lbs|lb", clean_str)
        lbs = float(parts[0].strip()) if parts[0].strip() else 0.0
        oz = 0.0
        if "oz" in clean_str:
            oz_match = re.search(r"(?:lbs|lb)\s*([\d.]+)\s*oz", clean_str)
            if oz_match:
                oz = float(oz_match.group(1))
        return lbs + (oz / 16.0)

    if clean_str.endswith("g"):
        grams_str = clean_str.rstrip("g").strip()
        grams = float(grams_str) if grams_str else 0.0
        return grams * 0.00220462

    try:
        return float(clean_str)
    except ValueError:
        return 0.0


def format_lbs_to_lbs_oz(lbs: float) -> str:
    total_oz = round(lbs * 16)
    lbs_part = total_oz // 16
    oz_part = total_oz % 16
    return f"{lbs_part} lbs {oz_part} oz"


def parse_date(date_str: str) -> datetime.date:
    if date_str.startswith("relative:-"):
        days_ago = int(date_str.split("relative:-")[1].split(" ")[0])
        return datetime.date.today() - datetime.timedelta(days=days_ago)
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unable to parse date: {date_str}")


def format_date_to_dmy(d_str: str | None) -> str:
    if not d_str:
        return ""
    if "." in d_str:
        return d_str
    parts = d_str.split("-")
    if len(parts) == 3:
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return d_str


def is_valid_baby_name(name: str | None) -> bool:
    if not name:
        return False
    name_clean = name.lower().strip()
    invalid_keywords = {
        "breastmilk",
        "breast",
        "breastfeeding",
        "formula",
        "solids",
        "solid",
        "diaper",
        "wet",
        "dirty",
        "weight",
        "kg",
        "lbs",
        "oz",
        "ml",
        "g",
        "both",
        "combination",
        "milk",
        "water",
        "food",
        "feed",
        "feeding",
    }
    if name_clean in invalid_keywords:
        return False
    if any(char.isdigit() for char in name_clean):
        return False
    for word in name_clean.split():
        if word in invalid_keywords or word in ("ml", "oz", "g", "kg", "lbs", "lb"):
            return False
    if len(name_clean.split()) > 3:
        return False
    return True


@node(rerun_on_resume=True)
async def resolve_newborn(ctx: Context, node_input: dict | None = None) -> Event:
    # Retrieve extracted info from LLM output or state
    extracted_dict = node_input or ctx.state.get("extracted_info")
    if not extracted_dict:
        extracted = ExtractedInfo()
    else:
        extracted = ExtractedInfo(**extracted_dict)

    # Retrieve current tracker state
    state_data = ctx.state.get("tracker_state") or {}
    tracker_state = TrackerState(**state_data) if state_data else TrackerState()
    await asyncio.to_thread(sync_profiles_from_disk, tracker_state)

    # 1. Handle resume inputs first
    # 1a. Handle clarified newborn name
    if ctx.resume_inputs and "clarify_newborn" in ctx.resume_inputs:
        clarified_name = _get_string_from_resume_input(
            ctx.resume_inputs["clarify_newborn"]
        )
        resolved_name = clarified_name.lower()

        # Update active newborn
        tracker_state.active_newborn = resolved_name
        if resolved_name not in tracker_state.newborns:
            tracker_state.newborns[resolved_name] = NewbornData(
                profile=NewbornProfile(name=clarified_name)
            )
        ctx.state["tracker_state"] = tracker_state.model_dump()
        await asyncio.to_thread(save_profiles_to_disk, tracker_state)

        # Check if birth_date or initial weight is missing for this newly resolved newborn
        newborn = tracker_state.newborns[resolved_name]
        if not newborn.profile.birth_date or not newborn.profile.initial_weight:
            yield RequestInput(
                interrupt_id="new_baby_wizard",
                message=f"I've set up the profile for {newborn.profile.name}. Please complete the newborn setup wizard.",
            )
            return

        yield Event(
            output={"resolved_name": resolved_name, "extracted": extracted.model_dump()}
        )
        return

    # 1b. Handle new baby wizard reply (can be via resume inputs or fresh user content JSON)
    wizard_data = None
    raw_str = ""
    if ctx.resume_inputs and "new_baby_wizard" in ctx.resume_inputs:
        wizard_data_str = _get_string_from_resume_input(
            ctx.resume_inputs["new_baby_wizard"]
        )
        try:
            wizard_data = json.loads(wizard_data_str)
        except Exception:
            pass
    else:
        user_content_val = None
        if getattr(ctx, "user_content", None) is not None:
            try:
                user_content_val = ctx.user_content
            except AttributeError:
                pass

        raw_str = ""
        if user_content_val and user_content_val.parts:
            for p in user_content_val.parts:
                if p.text:
                    raw_str += p.text
                elif p.function_response and p.function_response.response:
                    resp = p.function_response.response
                    if isinstance(resp, dict):
                        out = resp.get("output")
                        if out:
                            raw_str += out
        start_idx = raw_str.find("{")
        end_idx = raw_str.rfind("}")
        if start_idx != -1 and end_idx != -1 and start_idx < end_idx:
            json_candidate = raw_str[start_idx : end_idx + 1]
            try:
                data = json.loads(json_candidate)
                if "baby_name" in data and "birth_date" in data:
                    wizard_data = data
            except Exception:
                pass

    print("DEBUG: wizard_data =", wizard_data, "raw_str =", raw_str)
    if wizard_data:
        # Resolve baby name
        wizard_baby_name = wizard_data.get("baby_name", "").strip()
        resolved_name = (
            wizard_baby_name.lower().replace(" ", "_")
            if wizard_baby_name
            else tracker_state.active_newborn
        )

        # Check if setup was cancelled
        if wizard_data.get("cancelled"):
            if resolved_name and resolved_name in tracker_state.newborns:
                filename = resolved_name.replace(" ", "_") + ".json"
                filepath = os.path.join(PROFILES_DIR, filename)
                if os.path.exists(filepath) and not IS_TEST:
                    try:
                        os.remove(filepath)
                    except Exception as e:
                        print(f"Error removing cancelled profile {filename}: {e}")
                if resolved_name in tracker_state.newborns:
                    del tracker_state.newborns[resolved_name]

            # Re-evaluate active newborn from remaining profiles on disk
            existing_files = [
                f.replace(".json", "").replace("_", " ")
                for f in os.listdir(PROFILES_DIR)
                if f.endswith(".json")
            ]
            if existing_files:
                tracker_state.active_newborn = existing_files[0]
            else:
                tracker_state.active_newborn = None

            ctx.state["tracker_state"] = tracker_state.model_dump()
            await asyncio.to_thread(save_profiles_to_disk, tracker_state)

            yield Event(
                output={
                    "resolved_name": tracker_state.active_newborn,
                    "wizard_run": True,
                    "setup_cancelled": True,
                }
            )
            return

        if resolved_name:
            if resolved_name not in tracker_state.newborns:
                tracker_state.newborns[resolved_name] = NewbornData(
                    profile=NewbornProfile(
                        name=wizard_baby_name or resolved_name.replace("_", " ").title()
                    )
                )
            tracker_state.active_newborn = resolved_name
            newborn = tracker_state.newborns[resolved_name]

            # Handle baby name override
            if wizard_baby_name:
                newborn.profile.name = wizard_baby_name

            birth_date_str = wizard_data.get("birth_date")
            birth_date = parse_date(birth_date_str)
            birth_date_iso = birth_date.strftime("%Y-%m-%d")

            newborn.profile.birth_date = birth_date_iso
            newborn.profile.initial_weight = wizard_data.get("weight_birth")
            newborn.profile.photo_base64 = wizard_data.get("photo_base64")

            # Clear logs to populate freshly
            newborn.weights = []
            newborn.feedings = []
            newborn.diapers = []

            # 1. Weights seeding
            w_birth_lbs = parse_weight_to_lbs(wizard_data.get("weight_birth"))
            w_current_lbs = parse_weight_to_lbs(wizard_data.get("weight_current"))

            today = datetime.date.today()
            delta_days = (today - birth_date).days

            if delta_days < 0:
                newborn.weights.append(
                    WeightLog(
                        weight_kg=round(
                            parse_weight_to_lbs(wizard_data.get("weight_birth"))
                            * 0.45359237,
                            3,
                        ),
                        timestamp=f"{birth_date_iso} 09:00:00",
                    )
                )
            elif delta_days == 0:
                newborn.weights.append(
                    WeightLog(
                        weight_kg=round(w_birth_lbs * 0.45359237, 3),
                        timestamp=f"{birth_date_iso} 09:00:00",
                    )
                )
                if w_current_lbs != w_birth_lbs:
                    newborn.weights.append(
                        WeightLog(
                            weight_kg=round(w_current_lbs * 0.45359237, 3),
                            timestamp=f"{birth_date_iso} 18:00:00",
                        )
                    )
            else:
                for d in range(delta_days + 1):
                    log_date = birth_date + datetime.timedelta(days=d)
                    log_date_iso = log_date.strftime("%Y-%m-%d")

                    w_lbs = w_birth_lbs + (w_current_lbs - w_birth_lbs) * (
                        d / delta_days
                    )
                    w_kg = round(w_lbs * 0.45359237, 3)

                    newborn.weights.append(
                        WeightLog(weight_kg=w_kg, timestamp=f"{log_date_iso} 09:00:00")
                    )

            # 2. Feedings seeding
            feeds_per_day = wizard_data.get("feeds_per_day")
            if feeds_per_day is not None:
                try:
                    feeds_per_day = int(feeds_per_day)
                except (ValueError, TypeError):
                    feeds_per_day = 0

                if feeds_per_day > 0:
                    breast_percent = wizard_data.get("breast_percent")
                    formula_percent = wizard_data.get("formula_percent")

                    try:
                        breast_percent = (
                            float(breast_percent) if breast_percent is not None else 0.0
                        )
                    except ValueError:
                        breast_percent = 0.0
                    try:
                        formula_percent = (
                            float(formula_percent)
                            if formula_percent is not None
                            else 0.0
                        )
                    except ValueError:
                        formula_percent = 0.0

                    for d in range(delta_days + 1):
                        log_date = birth_date + datetime.timedelta(days=d)
                        log_date_iso = log_date.strftime("%Y-%m-%d")

                        breast_count = round(feeds_per_day * breast_percent / 100.0)

                        for i in range(feeds_per_day):
                            hour = int((2 + i * (20 / max(1, feeds_per_day - 1))) % 24)
                            time_str = f"{hour:02d}:00:00"

                            feed_type = (
                                "breastfeeding" if i < breast_count else "formula"
                            )
                            if breast_percent == 0 and formula_percent == 0:
                                feed_type = "combination"

                            feed_amount_ml = round(
                                44.36 + min(d * 2.07, 74.0), 1
                            )  # 1.5oz→44ml baseline, up to ~4oz

                            newborn.feedings.append(
                                FeedingLog(
                                    type=feed_type,
                                    amount=feed_amount_ml,
                                    unit="ml",
                                    timestamp=f"{log_date_iso} {time_str}",
                                )
                            )

            # 3. Diapers seeding
            wet_diapers = wizard_data.get("wet_diapers_per_day")
            dirty_diapers = wizard_data.get("dirty_diapers_per_day")
            if wet_diapers is not None or dirty_diapers is not None:
                try:
                    w_per_day = int(wet_diapers) if wet_diapers is not None else 0
                except (ValueError, TypeError):
                    w_per_day = 0
                try:
                    d_per_day = int(dirty_diapers) if dirty_diapers is not None else 0
                except (ValueError, TypeError):
                    d_per_day = 0

                if w_per_day > 0 or d_per_day > 0:
                    for d in range(delta_days + 1):
                        log_date = birth_date + datetime.timedelta(days=d)
                        log_date_iso = log_date.strftime("%Y-%m-%d")

                        for i in range(w_per_day):
                            hour = int((4 + i * (18 / max(1, w_per_day - 1))) % 24)
                            newborn.diapers.append(
                                DiaperLog(
                                    type="wet",
                                    timestamp=f"{log_date_iso} {hour:02d}:00:00",
                                )
                            )
                        for i in range(d_per_day):
                            hour = int((6 + i * (16 / max(1, d_per_day - 1))) % 24)
                            newborn.diapers.append(
                                DiaperLog(
                                    type="dirty",
                                    timestamp=f"{log_date_iso} {hour:02d}:30:00",
                                )
                            )

            ctx.state["tracker_state"] = tracker_state.model_dump()
            await asyncio.to_thread(save_profiles_to_disk, tracker_state)

            yield Event(
                output={
                    "resolved_name": resolved_name,
                    "extracted": extracted.model_dump(),
                    "wizard_run": True,
                }
            )
            return

    # 2. Extract newborn name from message or resolve from existing
    existing_names = list(tracker_state.newborns.keys())
    resolved_name = None

    # Zero-Reconfirmation: always assume active newborn currently selected in dropdown if it exists,
    # UNLESS the user explicitly wants to create a new newborn or specified a different name.
    if (
        tracker_state.active_newborn
        and tracker_state.active_newborn in tracker_state.newborns
        and not extracted.is_new_newborn
        and not (
            extracted.newborn_name
            and extracted.newborn_name.lower().strip() != tracker_state.active_newborn
        )
    ):
        resolved_name = tracker_state.active_newborn
    else:
        newborn_name = extracted.newborn_name
        if newborn_name and not is_valid_baby_name(newborn_name):
            newborn_name = None

        if not newborn_name:
            if not existing_names or extracted.is_new_newborn:
                # No babies yet or user explicitly wants to add a new baby - must clarify name
                yield RequestInput(
                    interrupt_id="clarify_newborn",
                    message="Welcome to Newborn Tracker! What is the name of the newborn baby you want to add?",
                )
                return
            elif len(existing_names) == 1:
                resolved_name = existing_names[0]
            else:
                resolved_name = existing_names[0]
        else:
            resolved_name = newborn_name.lower()
            if resolved_name not in tracker_state.newborns:
                # First time seeing this baby's name
                tracker_state.newborns[resolved_name] = NewbornData(
                    profile=NewbornProfile(
                        name=newborn_name, birth_date=extracted.birth_date
                    )
                )
                tracker_state.active_newborn = resolved_name
                ctx.state["tracker_state"] = tracker_state.model_dump()
                await asyncio.to_thread(save_profiles_to_disk, tracker_state)
            else:
                tracker_state.active_newborn = resolved_name

    # Set/Update birth date if extracted and not yet present
    if (
        extracted.birth_date
        and not tracker_state.newborns[resolved_name].profile.birth_date
    ):
        tracker_state.newborns[resolved_name].profile.birth_date = extracted.birth_date
        ctx.state["tracker_state"] = tracker_state.model_dump()
        await asyncio.to_thread(save_profiles_to_disk, tracker_state)

    # If the resolved newborn does not have a birth date or initial weight, ask for the wizard!
    newborn = tracker_state.newborns[resolved_name]
    if not newborn.profile.birth_date or not newborn.profile.initial_weight:
        yield RequestInput(
            interrupt_id="new_baby_wizard",
            message=f"I've set up the profile for {newborn.profile.name}. Please complete the newborn setup wizard.",
        )
        return

    yield Event(
        output={"resolved_name": resolved_name, "extracted": extracted.model_dump()}
    )


@node
async def update_state_and_respond(ctx: Context, node_input: dict) -> Event:
    resolved_name = node_input["resolved_name"]
    if node_input.get("setup_cancelled"):
        yield Event(
            output={"resolved_name": resolved_name, "wizard_run": True},
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text="New baby setup was cancelled.")],
            ),
        )
        return

    extracted_dict = dict(node_input["extracted"])
    if "feedings" not in extracted_dict or not extracted_dict["feedings"]:
        if extracted_dict.get("feeding_type") or extracted_dict.get(
            "feeding_amount_oz"
        ):
            extracted_dict["feedings"] = [
                {
                    "type": extracted_dict.get("feeding_type") or "combination",
                    "amount": extracted_dict.get("feeding_amount_oz") or 0.0,
                }
            ]
    extracted = ExtractedInfo(**extracted_dict)
    wizard_run = node_input.get("wizard_run", False)

    state_data = ctx.state.get("tracker_state") or {}
    tracker_state = TrackerState(**state_data) if state_data else TrackerState()
    await asyncio.to_thread(sync_profiles_from_disk, tracker_state)
    newborn = tracker_state.newborns[resolved_name]

    if extracted.unit_system:
        newborn.profile.unit_system = extracted.unit_system

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updates = []

    if not wizard_run:
        # 1. Weight log
        if extracted.weight:
            # Parse the weight string and always store as kg
            weight_kg = round(parse_weight_to_lbs(extracted.weight) * 0.45359237, 3)
            newborn.weights.append(WeightLog(weight_kg=weight_kg, timestamp=timestamp))
            pref_unit = (
                extracted.unit_system or newborn.profile.unit_system or "imperial"
            )
            if pref_unit == "metric":
                display_weight = f"{weight_kg} kg"
            else:
                total_oz = round(weight_kg / 0.45359237 * 16)
                display_weight = f"{total_oz // 16} lbs {total_oz % 16} oz"
            updates.append(f"weight of {display_weight}")

        # 2. Feeding log
        if extracted.feedings:
            pref_unit = (
                extracted.unit_system or newborn.profile.unit_system or "imperial"
            )
            feed_parts = []
            for f in extracted.feedings:
                # Normalize feeding type to standard values
                ftype = f.type.lower().strip()
                if ftype in ("breast", "breastmilk", "breastfeeding", "breast milk"):
                    ftype = "breastfeeding"
                elif ftype in ("formula", "formula milk"):
                    ftype = "formula"
                elif ftype in ("solids", "solid", "food", "puree", "purée"):
                    ftype = "solids"
                else:
                    ftype = "formula"

                is_solid = ftype == "solids"
                unit = "g" if is_solid else "ml"
                newborn.feedings.append(
                    FeedingLog(
                        type=ftype,
                        amount=f.amount,
                        unit=unit,
                        timestamp=timestamp,
                    )
                )
                if is_solid:
                    feed_parts.append(f"Solids: {f.amount} g")
                elif pref_unit == "metric":
                    type_label = "Breastmilk" if ftype == "breastfeeding" else "Formula"
                    feed_parts.append(f"{type_label}: {f.amount} ml")
                else:
                    amt_oz = round(f.amount / 29.5735, 2)
                    type_label = "Breastmilk" if ftype == "breastfeeding" else "Formula"
                    feed_parts.append(f"{type_label}: {amt_oz} oz")
            updates.append("feeding logged: " + ", ".join(feed_parts))

        # 3. Diaper log
        if extracted.diaper_type:
            newborn.diapers.append(
                DiaperLog(type=extracted.diaper_type, timestamp=timestamp)
            )
            updates.append(f"diaper status: {extracted.diaper_type}")
        elif extracted.diaper_wet_count or extracted.diaper_dirty_count:
            d_type = (
                "both"
                if (extracted.diaper_wet_count and extracted.diaper_dirty_count)
                else ("wet" if extracted.diaper_wet_count else "dirty")
            )
            newborn.diapers.append(DiaperLog(type=d_type, timestamp=timestamp))
            updates.append(f"diaper status: {d_type}")

        # Save updated tracker state
        ctx.state["tracker_state"] = tracker_state.model_dump()
        await asyncio.to_thread(save_profiles_to_disk, tracker_state)

    baby_name = newborn.profile.name
    bday_dmy = format_date_to_dmy(newborn.profile.birth_date)
    birth_date_str = f" (born {bday_dmy})" if bday_dmy else ""
    baby_name_with_bday = f"{baby_name}{birth_date_str}"

    if wizard_run:
        msg = f"Profile for {baby_name_with_bday} successfully set up using the newborn wizard! I've populated the historical logs back to their birth date."
    elif not updates:
        if extracted.birth_date or (
            ctx.resume_inputs and "ask_birth_date" in ctx.resume_inputs
        ):
            msg = f"Profile for {baby_name} updated with birth date {bday_dmy}."
        elif extracted.is_new_newborn or (
            len(newborn.weights) == 0
            and len(newborn.feedings) == 0
            and len(newborn.diapers) == 0
        ):
            msg = f"Created profile for {baby_name_with_bday}! Let me know when you want to track feeding, diapers, or weight."
        else:
            msg = f"I'm tracking stats for {baby_name_with_bday}. What would you like to record (weight, feeding, diaper)?"
    else:
        msg = f"Logged for {baby_name_with_bday} - " + ", ".join(updates) + "."

    # Calculate daily stats (today)
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    wet_today = sum(
        1 for d in newborn.diapers if today in d.timestamp and d.type in ("wet", "both")
    )
    dirty_today = sum(
        1
        for d in newborn.diapers
        if today in d.timestamp and d.type in ("dirty", "both")
    )
    unique_feed_times = {f.timestamp for f in newborn.feedings if today in f.timestamp}
    feedings_today = len(unique_feed_times)

    stats_msg = f"\nDaily summary for {baby_name}: {feedings_today} feedings, {wet_today} wet diapers, {dirty_today} dirty diapers."
    msg += stats_msg

    yield Event(
        content=types.Content(role="model", parts=[types.Part.from_text(text=msg)]),
        output=msg,
    )


# =====================================================================
# Workflow Configuration & Export
# =====================================================================

root_agent = Workflow(
    name="newborn_tracker_workflow",
    edges=[
        ("START", extractor),
        (extractor, resolve_newborn),
        (resolve_newborn, update_state_and_respond),
    ],
    state_schema=WorkflowState,
)

app = App(
    root_agent=root_agent,
    name="app",
)
