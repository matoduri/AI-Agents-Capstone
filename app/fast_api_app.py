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

import asyncio
import base64
import contextlib
import datetime
import json
import logging
import os
from collections.abc import AsyncIterator

import google.auth
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.cloud import logging as google_cloud_logging
from pydantic import BaseModel

from app.app_utils import services
from app.app_utils.a2a import attach_a2a_routes
from app.app_utils.telemetry import setup_telemetry
from app.app_utils.typing import Feedback

load_dotenv()

try:
    setup_telemetry()
    _, project_id = google.auth.default()
    logging_client = google_cloud_logging.Client()
    logger = logging_client.logger(__name__)
    logger_is_gcp = True
except Exception:
    project_id = None
    logger = logging.getLogger(__name__)
    logging.basicConfig(level=logging.INFO)
    logger_is_gcp = False

allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.agent import app as adk_app
    from app.agent import root_agent

    runner = Runner(
        app=adk_app,
        session_service=services.get_session_service(),
        artifact_service=services.get_artifact_service(),
        auto_create_session=True,
    )
    app.state.runner = runner
    app.state.agent_app_name = adk_app.name
    await attach_a2a_routes(
        app,
        agent=root_agent,
        runner=runner,
        task_store=InMemoryTaskStore(),
        rpc_path=f"/a2a/{adk_app.name}",
    )
    yield


app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=services.ARTIFACT_SERVICE_URI,
    allow_origins=allow_origins,
    session_service_uri=services.SESSION_SERVICE_URI,
    otel_to_cloud=False,
    lifespan=lifespan,
)

app.title = "newborn-tracker"
app.description = "API for interacting with the Agent newborn-tracker"


class CachedStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=3600"
        return response


# Setup static directory serving
static_dir = os.path.join(AGENT_DIR, "app", "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", CachedStaticFiles(directory=static_dir), name="static")


@app.get("/")
@app.get("/dashboard")
def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.get("/api/stats/{session_id}")
async def get_stats(session_id: str):
    runner = app.state.runner
    session_service = runner.session_service
    session = await session_service.get_session(
        app_name=app.state.agent_app_name, user_id="default_user", session_id=session_id
    )
    if not session:
        try:
            session = await session_service.create_session(
                app_name=app.state.agent_app_name,
                user_id="default_user",
                session_id=session_id,
            )
        except Exception as e:
            logger.error(f"Error creating session: {e}")

    today = datetime.date.today()

    # We read files from baby_profiles folder
    profiles_dir = os.environ.get(
        "PROFILES_DIR",
        os.path.join(AGENT_DIR, "baby_profiles"),
    )
    os.makedirs(profiles_dir, exist_ok=True)

    def parse_relative_date_string(val):
        if isinstance(val, str) and val.startswith("relative:-"):
            parts = val.split(" ")
            days_ago = int(parts[0].split("relative:-")[1])
            target_date = today - datetime.timedelta(days=days_ago)
            if len(parts) > 1:
                return f"{target_date} {parts[1]}"
            return str(target_date)
        return val

    def load_profiles_sync():
        loaded = {}
        for fname in os.listdir(profiles_dir):
            if fname.endswith(".json"):
                key = fname.replace(".json", "").replace("_", " ")
                file_path = os.path.join(profiles_dir, fname)
                try:
                    with open(file_path) as f:
                        data = json.load(f)
                    loaded[key] = data
                except Exception as e:
                    logger.error(f"Error loading baby profile {fname}: {e}")
        return loaded

    newborns = {}
    raw_newborns = await asyncio.to_thread(load_profiles_sync)
    for key, data in raw_newborns.items():
        # Apply relative date parsing
        profile = data.setdefault("profile", {})
        if "birth_date" in profile:
            profile["birth_date"] = parse_relative_date_string(profile["birth_date"])

        for w in data.setdefault("weights", []):
            if "timestamp" in w:
                w["timestamp"] = parse_relative_date_string(w["timestamp"])

        for f_log in data.setdefault("feedings", []):
            if "timestamp" in f_log:
                f_log["timestamp"] = parse_relative_date_string(f_log["timestamp"])

        for d_log in data.setdefault("diapers", []):
            if "timestamp" in d_log:
                d_log["timestamp"] = parse_relative_date_string(d_log["timestamp"])

        newborns[key] = data

    # Build response tracker state
    active_newborn = "test - leo"
    if session and session.state and "tracker_state" in session.state:
        active_newborn = (
            session.state["tracker_state"].get("active_newborn") or active_newborn
        )

    if active_newborn not in newborns and newborns:
        active_newborn = next(iter(newborns.keys()))

    state_data = {
        "active_newborn": active_newborn,
        "newborns": newborns,
    }

    return state_data


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    """Collect and log feedback.

    Args:
        feedback: The feedback data to log

    Returns:
        Success message
    """
    if logger_is_gcp:
        try:
            logger.log_struct(feedback.model_dump(), severity="INFO")
        except Exception:
            logging.getLogger(__name__).info(
                f"Feedback collected: {feedback.model_dump()}"
            )
    else:
        logger.info(f"Feedback collected: {feedback.model_dump()}")
    return {"status": "success"}


class PhotoPayload(BaseModel):
    photo_base64: str | None = None


class LogPayload(BaseModel):
    category: str
    timestamp: str
    weight_kg: float | None = None
    feeding_type: str | None = None
    feeding_amount: float | None = None  # ml for liquids, g for solids
    feeding_unit: str | None = None  # "ml" or "g"
    diaper_type: str | None = None


@app.delete("/api/profiles/{name}")
async def delete_profile(name: str):
    profiles_dir = os.environ.get(
        "PROFILES_DIR", os.path.join(AGENT_DIR, "baby_profiles")
    )
    profile_path = os.path.join(profiles_dir, f"{name.lower().replace(' ', '_')}.json")
    if os.path.exists(profile_path):
        try:
            await asyncio.to_thread(os.remove, profile_path)
            return {"status": "success", "message": f"Profile {name} deleted"}
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to delete profile: {e}"
            ) from e
    raise HTTPException(status_code=404, detail="Profile not found")


@app.post("/api/profiles/{name}/photo")
async def update_profile_photo(name: str, payload: PhotoPayload):
    profiles_dir = os.environ.get(
        "PROFILES_DIR", os.path.join(AGENT_DIR, "baby_profiles")
    )
    profile_path = os.path.join(profiles_dir, f"{name.lower().replace(' ', '_')}.json")
    if os.path.exists(profile_path):
        try:
            photo_data = payload.photo_base64
            photo_url = None
            if photo_data:
                photos_dir = os.path.join(AGENT_DIR, "app", "static", "photos")
                os.makedirs(photos_dir, exist_ok=True)
                ext = "jpg"
                if "base64," in photo_data:
                    header, base64_str = photo_data.split("base64,", 1)
                    if "png" in header:
                        ext = "png"
                    elif "gif" in header:
                        ext = "gif"
                    elif "webp" in header:
                        ext = "webp"
                    img_bytes = base64.b64decode(base64_str)
                else:
                    img_bytes = base64.b64decode(photo_data)

                safe_name = name.lower().replace(" ", "_")
                filename = f"{safe_name}.{ext}"
                file_path = os.path.join(photos_dir, filename)

                def write_img():
                    with open(file_path, "wb") as f:
                        f.write(img_bytes)

                await asyncio.to_thread(write_img)
                photo_url = f"/static/photos/{filename}"

            def save_photo_sync():
                with open(profile_path) as f:
                    data = json.load(f)
                data["profile"]["photo_base64"] = photo_url
                with open(profile_path, "w") as f:
                    json.dump(data, f, indent=2)

            await asyncio.to_thread(save_photo_sync)

            # Invalidate cache in agent
            from app.agent import _profiles_mtime_cache

            cache_key = f"{name.lower().replace(' ', '_')}.json"
            if cache_key in _profiles_mtime_cache:
                del _profiles_mtime_cache[cache_key]

            return {"status": "success", "photo_url": photo_url}
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to update photo: {e}"
            ) from e
    raise HTTPException(status_code=404, detail="Profile not found")


@app.post("/api/profiles/{name}/logs")
async def add_profile_log(name: str, payload: LogPayload):
    profiles_dir = os.environ.get(
        "PROFILES_DIR", os.path.join(AGENT_DIR, "baby_profiles")
    )
    profile_path = os.path.join(profiles_dir, f"{name.lower().replace(' ', '_')}.json")
    if os.path.exists(profile_path):
        try:

            def save_log_sync():
                with open(profile_path) as f:
                    data = json.load(f)

                if payload.category == "weight":
                    w_log = {
                        "weight_kg": payload.weight_kg,
                        "timestamp": payload.timestamp,
                    }
                    data.setdefault("weights", []).append(w_log)
                elif payload.category == "feeding":
                    f_log = {
                        "type": payload.feeding_type or "combination",
                        "amount": payload.feeding_amount,
                        "unit": payload.feeding_unit or "ml",
                        "timestamp": payload.timestamp,
                    }
                    data.setdefault("feedings", []).append(f_log)
                elif payload.category == "diapers":
                    d_log = {
                        "type": payload.diaper_type or "wet",
                        "timestamp": payload.timestamp,
                    }
                    data.setdefault("diapers", []).append(d_log)

                with open(profile_path, "w") as f:
                    json.dump(data, f, indent=2)

            await asyncio.to_thread(save_log_sync)

            # Invalidate caches in agent.py
            from app.agent import _profiles_mtime_cache

            cache_key = f"{name.lower().replace(' ', '_')}.json"
            if cache_key in _profiles_mtime_cache:
                del _profiles_mtime_cache[cache_key]

            return {"status": "success"}
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to save log: {e}"
            ) from e
    raise HTTPException(status_code=404, detail="Profile not found")


class EditLogPayload(BaseModel):
    category: str
    original_timestamp: str
    new_timestamp: str
    weight_kg: float | None = None
    feeding_type: str | None = None
    feeding_amount: float | None = None  # ml for liquids, g for solids
    feeding_unit: str | None = None  # "ml" or "g"
    diaper_type: str | None = None


@app.put("/api/profiles/{name}/logs")
async def edit_profile_log(name: str, payload: EditLogPayload):
    profiles_dir = os.environ.get(
        "PROFILES_DIR", os.path.join(AGENT_DIR, "baby_profiles")
    )
    profile_path = os.path.join(profiles_dir, f"{name.lower().replace(' ', '_')}.json")
    if os.path.exists(profile_path):
        try:

            def edit_log_sync():
                with open(profile_path) as f:
                    data = json.load(f)

                found = False
                if payload.category == "weight":
                    weights = data.setdefault("weights", [])
                    for idx, w in enumerate(weights):
                        if w.get("timestamp") == payload.original_timestamp:
                            weights[idx] = {
                                "weight_kg": payload.weight_kg,
                                "timestamp": payload.new_timestamp,
                            }
                            found = True
                            break
                elif payload.category == "feeding":
                    feedings = data.setdefault("feedings", [])
                    for idx, f_log in enumerate(feedings):
                        if f_log.get("timestamp") == payload.original_timestamp:
                            feedings[idx] = {
                                "type": payload.feeding_type or "combination",
                                "amount": payload.feeding_amount,
                                "unit": payload.feeding_unit or "ml",
                                "timestamp": payload.new_timestamp,
                            }
                            found = True
                            break
                elif payload.category == "diapers":
                    diapers = data.setdefault("diapers", [])
                    for idx, d_log in enumerate(diapers):
                        if d_log.get("timestamp") == payload.original_timestamp:
                            diapers[idx] = {
                                "type": payload.diaper_type or "wet",
                                "timestamp": payload.new_timestamp,
                            }
                            found = True
                            break

                if not found:
                    return False

                with open(profile_path, "w") as f:
                    json.dump(data, f, indent=2)
                return True

            success = await asyncio.to_thread(edit_log_sync)
            if not success:
                raise HTTPException(status_code=404, detail="Log entry not found")

            # Invalidate caches in agent.py
            from app.agent import _profiles_mtime_cache

            cache_key = f"{name.lower().replace(' ', '_')}.json"
            if cache_key in _profiles_mtime_cache:
                del _profiles_mtime_cache[cache_key]

            return {"status": "success"}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to edit log: {e}"
            ) from e
    raise HTTPException(status_code=404, detail="Profile not found")


class DeleteLogPayload(BaseModel):
    category: str
    timestamp: str


@app.delete("/api/profiles/{name}/logs")
async def delete_profile_log(name: str, payload: DeleteLogPayload):
    profiles_dir = os.environ.get(
        "PROFILES_DIR", os.path.join(AGENT_DIR, "baby_profiles")
    )
    profile_path = os.path.join(profiles_dir, f"{name.lower().replace(' ', '_')}.json")
    if os.path.exists(profile_path):
        try:

            def delete_log_sync():
                with open(profile_path) as f:
                    data = json.load(f)

                found = False
                if payload.category == "weight":
                    weights = data.setdefault("weights", [])
                    original_len = len(weights)
                    data["weights"] = [
                        w for w in weights if w.get("timestamp") != payload.timestamp
                    ]
                    if len(data["weights"]) < original_len:
                        found = True
                elif payload.category == "feeding":
                    feedings = data.setdefault("feedings", [])
                    original_len = len(feedings)
                    data["feedings"] = [
                        f_log
                        for f_log in feedings
                        if f_log.get("timestamp") != payload.timestamp
                    ]
                    if len(data["feedings"]) < original_len:
                        found = True
                elif payload.category == "diapers":
                    diapers = data.setdefault("diapers", [])
                    original_len = len(diapers)
                    data["diapers"] = [
                        d_log
                        for d_log in diapers
                        if d_log.get("timestamp") != payload.timestamp
                    ]
                    if len(data["diapers"]) < original_len:
                        found = True

                if not found:
                    return False

                with open(profile_path, "w") as f:
                    json.dump(data, f, indent=2)
                return True

            success = await asyncio.to_thread(delete_log_sync)
            if not success:
                raise HTTPException(status_code=404, detail="Log entry not found")

            # Invalidate caches in agent.py
            from app.agent import _profiles_mtime_cache

            cache_key = f"{name.lower().replace(' ', '_')}.json"
            if cache_key in _profiles_mtime_cache:
                del _profiles_mtime_cache[cache_key]

            return {"status": "success"}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to delete log: {e}"
            ) from e
    raise HTTPException(status_code=404, detail="Profile not found")


class ActiveNewbornPayload(BaseModel):
    active_newborn: str


@app.post("/api/session/{session_id}/active")
async def set_active_baby(session_id: str, payload: ActiveNewbornPayload):
    runner = app.state.runner
    session_service = runner.session_service
    session = await session_service.get_session(
        app_name=app.state.agent_app_name, user_id="default_user", session_id=session_id
    )
    if session:
        if "tracker_state" not in session.state:
            session.state["tracker_state"] = {}
        session.state["tracker_state"]["active_newborn"] = payload.active_newborn
        await session_service.update_session(session)

        from app.agent import _profiles_mtime_cache

        _profiles_mtime_cache.clear()

    return {"status": "success"}


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
