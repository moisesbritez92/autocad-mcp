from __future__ import annotations

from pathlib import Path
from typing import Any


def load_architecture_rules(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return {
        "path": str(path),
        "loaded": True,
        "raw_text": text,
        "rules": {
            "bedroom_min_area": 8.0,
            "bathroom_min_area": 3.0,
            "window_area_ratio": 0.10,
            "door_clearance_m": 0.60,
            "wet_core_max_distance_m": 4.0,
            "corridor_area_ratio_max": 0.10,
            "room_aspect_ratio_max": 2.0,
            "usable_area_ratio_min": 0.85,
            "master_bedroom_min_area": 11.0,
            "secondary_bedroom_target_min": 8.0,
        },
        "principles": [
            "public_private_separation",
            "open_space_living_kitchen",
            "circulation_efficiency",
            "natural_lighting",
            "wet_core_grouping",
            "window_hierarchy",
            "bedroom_hierarchy",
            "structural_alignment",
            "entry_transition",
            "indoor_outdoor_connection",
        ],
    }
