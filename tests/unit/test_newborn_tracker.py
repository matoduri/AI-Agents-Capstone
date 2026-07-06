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

import pytest
from google.adk.agents.context import Context
from google.adk.events.event import Event
from google.adk.events.request_input import RequestInput

from app.agent import (
    resolve_newborn,
    update_state_and_respond,
)


class MockContext(Context):
    def __init__(self, state=None, resume_inputs=None):
        self._state = state or {}
        self._resume_inputs = resume_inputs or {}

    @property
    def state(self):
        return self._state

    @property
    def resume_inputs(self):
        return self._resume_inputs


@pytest.mark.asyncio
async def test_resolve_newborn_new_profile_asks_for_wizard():
    ctx = MockContext()
    node_input = {
        "newborn_name": "Liam",
        "birth_date": "2026-07-04",
        "is_new_newborn": True,
    }

    events = []
    async for event in resolve_newborn._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], RequestInput)
    assert events[0].interrupt_id == "new_baby_wizard"

    tracker_state_dict = ctx.state["tracker_state"]
    assert "liam" in tracker_state_dict["newborns"]
    assert tracker_state_dict["active_newborn"] == "liam"


@pytest.mark.asyncio
async def test_resolve_newborn_resume_new_baby_wizard():
    import json

    wizard_payload = {
        "birth_date": "relative:-5",
        "weight_birth": "7 lbs 8 oz",
        "weight_current": "7 lbs 13 oz",
        "feeds_per_day": 8,
        "breast_percent": 50,
        "formula_percent": 50,
        "wet_diapers_per_day": 6,
        "dirty_diapers_per_day": 4,
    }

    ctx = MockContext(
        state={
            "tracker_state": {
                "newborns": {
                    "liam": {
                        "profile": {
                            "name": "Liam",
                            "birth_date": None,
                            "initial_weight": None,
                        },
                        "feedings": [],
                        "diapers": [],
                        "weights": [],
                    }
                },
                "active_newborn": "liam",
            }
        },
        resume_inputs={"new_baby_wizard": json.dumps(wizard_payload)},
    )
    node_input = {"newborn_name": None, "birth_date": None, "is_new_newborn": False}

    events = []
    async for event in resolve_newborn._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], Event)
    assert events[0].output["resolved_name"] == "liam"
    assert events[0].output["wizard_run"] is True

    tracker_state_dict = ctx.state["tracker_state"]
    liam_profile = tracker_state_dict["newborns"]["liam"]["profile"]

    # Check that birth date and initial weight are saved
    assert liam_profile["birth_date"] is not None
    assert liam_profile["initial_weight"] == "7 lbs 8 oz"

    # Check weight interpolation (delta_days = 5, so 6 logs generated)
    weights = tracker_state_dict["newborns"]["liam"]["weights"]
    assert len(weights) == 6
    # Weights now stored as kg floats
    assert isinstance(weights[0]["weight_kg"], float)
    # Birth weight 7 lbs 8 oz = 3.402 kg
    assert abs(weights[0]["weight_kg"] - 3.402) < 0.01
    # Current weight 7 lbs 13 oz = 3.544 kg
    assert abs(weights[-1]["weight_kg"] - 3.544) < 0.01

    # Check feeds and diaper logs generated
    feedings = tracker_state_dict["newborns"]["liam"]["feedings"]
    assert len(feedings) == 48  # 8 feeds * 6 days

    diapers = tracker_state_dict["newborns"]["liam"]["diapers"]
    assert len(diapers) == 60  # (6 wet + 4 dirty) * 6 days


@pytest.mark.asyncio
async def test_resolve_newborn_missing_name_no_babies():
    ctx = MockContext()
    node_input = {"newborn_name": None, "birth_date": None, "is_new_newborn": False}

    events = []
    async for event in resolve_newborn._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], RequestInput)
    assert events[0].interrupt_id == "clarify_newborn"


@pytest.mark.asyncio
async def test_resolve_newborn_resume_clarify():
    ctx = MockContext(
        state={"tracker_state": {"newborns": {}, "active_newborn": None}},
        resume_inputs={"clarify_newborn": "Noah"},
    )
    node_input = {"newborn_name": None, "birth_date": None, "is_new_newborn": False}

    # This should clarify the name "Noah", but since birth_date/initial_weight are missing, it should yield new_baby_wizard
    events = []
    async for event in resolve_newborn._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], RequestInput)
    assert events[0].interrupt_id == "new_baby_wizard"

    tracker_state_dict = ctx.state["tracker_state"]
    assert "noah" in tracker_state_dict["newborns"]
    assert tracker_state_dict["active_newborn"] == "noah"


@pytest.mark.asyncio
async def test_update_state_and_respond():
    ctx = MockContext(
        state={
            "tracker_state": {
                "newborns": {
                    "liam": {
                        "profile": {"name": "Liam", "birth_date": "2026-07-04"},
                        "feedings": [],
                        "diapers": [],
                        "weights": [],
                    }
                },
                "active_newborn": "liam",
            }
        }
    )

    node_input = {
        "resolved_name": "liam",
        "extracted": {
            "newborn_name": "Liam",
            "birth_date": None,
            "weight": "7 lbs 8 oz",
            "feeding_type": "formula",
            "feeding_amount_oz": 3.5,
            "diaper_type": "wet",
            "is_new_newborn": False,
        },
    }

    events = []
    async for event in update_state_and_respond._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert "Logged for Liam (born 04.07.2026)" in events[0].output
    assert "weight of" in events[0].output  # unit depends on pref_unit
    assert "feeding logged: Formula:" in events[0].output
    assert "diaper status: wet" in events[0].output


@pytest.mark.asyncio
async def test_resolve_newborn_wizard_cancelled():
    import json

    ctx = MockContext(
        state={
            "tracker_state": {
                "newborns": {
                    "liam": {
                        "profile": {
                            "name": "Liam",
                            "birth_date": None,
                            "initial_weight": None,
                        },
                        "feedings": [],
                        "diapers": [],
                        "weights": [],
                    }
                },
                "active_newborn": "liam",
            }
        },
        resume_inputs={"new_baby_wizard": json.dumps({"cancelled": True})},
    )
    node_input = {"newborn_name": None, "birth_date": None, "is_new_newborn": False}

    events = []
    async for event in resolve_newborn._func(ctx, node_input):
        events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], Event)
    assert events[0].output.get("setup_cancelled") is True
    assert "liam" not in ctx.state["tracker_state"]["newborns"]


@pytest.mark.asyncio
async def test_update_state_and_respond_setup_cancelled():
    ctx = MockContext(state={"tracker_state": {"newborns": {}, "active_newborn": None}})
    node_input = {
        "resolved_name": None,
        "setup_cancelled": True,
        "extracted": None,
    }

    events = []
    async for event in update_state_and_respond._func(ctx, node_input):
        events.append(event)
    assert len(events) == 1
    assert events[0].content.parts[0].text == "New baby setup was cancelled."
