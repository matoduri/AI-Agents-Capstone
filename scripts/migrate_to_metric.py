#!/usr/bin/env python3
"""Migrate baby profile JSON files to metric-only storage."""

from __future__ import annotations

import json
import os
import re
import sys


def parse_weight_to_kg(weight_str: str) -> float:
    if not weight_str:
        return 0.0
    s = weight_str.lower().strip()
    if "kg" in s:
        return float(s.replace("kg", "").strip())
    if "g" in s and "lbs" not in s and "lb" not in s:
        g = float(re.sub(r"[^\d.]", "", s))
        return round(g / 1000.0, 3)
    lbs, oz = 0.0, 0.0
    if "lbs" in s or "lb" in s:
        parts = re.split(r"lbs|lb", s)
        lbs = float(parts[0].strip()) if parts[0].strip() else 0.0
        oz_match = re.search(r"[\d.]+\s*oz", s)
        if oz_match:
            oz = float(re.sub(r"[^\d.]", "", oz_match.group()))
    else:
        try:
            lbs = float(s)
        except ValueError:
            return 0.0
    return round((lbs + oz / 16.0) * 0.45359237, 3)


def migrate_profile(path: str) -> None:
    with open(path) as f:
        data = json.load(f)
    changed = False
    new_feedings = []
    for entry in data.get("feedings", []):
        e = dict(entry)
        if "amount_oz" in e:
            raw = e.pop("amount_oz")
            t = e.get("type", "").lower()
            if t == "solids":
                e["amount"] = float(raw) if raw is not None else 0.0
                e["unit"] = "g"
            else:
                e["amount"] = round(float(raw) * 29.5735, 1) if raw is not None else 0.0
                e["unit"] = "ml"
            changed = True
        new_feedings.append(e)
    data["feedings"] = new_feedings
    new_weights = []
    for entry in data.get("weights", []):
        e = dict(entry)
        if "weight_lbs_oz" in e:
            e["weight_kg"] = parse_weight_to_kg(e.pop("weight_lbs_oz"))
            changed = True
        new_weights.append(e)
    data["weights"] = new_weights
    if changed:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  Migrated: {path}")
    else:
        print(f"  Already up-to-date: {path}")


def main() -> None:
    profiles_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "baby_profiles",
    )
    if not os.path.isdir(profiles_dir):
        print(f"Profiles directory not found: {profiles_dir}", file=sys.stderr)
        sys.exit(1)
    json_files = [f for f in os.listdir(profiles_dir) if f.endswith(".json")]
    if not json_files:
        print("No profile JSON files found.")
        return
    print(f"Migrating {len(json_files)} profile(s) in {profiles_dir} ...")
    for fname in json_files:
        migrate_profile(os.path.join(profiles_dir, fname))
    print("Done.")


if __name__ == "__main__":
    main()
