from __future__ import annotations

from typing import Any


def _score_from_checks(checks: list[dict[str, Any]]) -> dict[str, float]:
    if not checks:
        return {
            "design_score": 0.5,
            "lighting_score": 0.5,
            "circulation_score": 0.5,
            "space_efficiency": 0.5,
            "room_proportions": 0.5,
        }

    total = len(checks)
    passes = sum(1 for c in checks if c.get("result") == "pass")
    warns = sum(1 for c in checks if c.get("result") == "warn")
    base = (passes + 0.5 * warns) / total
    return {
        "design_score": round(base, 2),
        "lighting_score": round(base, 2),
        "circulation_score": round(min(1.0, base + 0.05), 2),
        "space_efficiency": round(base, 2),
        "room_proportions": round(base, 2),
    }


def validate_rooms(rooms: list[dict[str, Any]], ruleset: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], dict[str, float]]:
    rules = (ruleset or {}).get("rules", {})
    bedroom_min = float(rules.get("bedroom_min_area", 8.0))
    bathroom_min = float(rules.get("bathroom_min_area", 3.0))

    checks = []
    for room in rooms:
        label = (room.get("label") or "").lower()
        area = float(room.get("area") or 0)
        windows = room.get("connected_windows", [])
        bbox = room.get("bounding_box") or [0, 0, 0, 0]
        width = max(float(bbox[2]) - float(bbox[0]), 0.001)
        height = max(float(bbox[3]) - float(bbox[1]), 0.001)
        ratio = max(width, height) / min(width, height)

        if "bedroom" in label or "dorm" in label:
            checks.append({
                "rule": "bedroom_min_area",
                "room": room["label"],
                "result": "pass" if area >= bedroom_min else "fail",
                "value": area,
                "minimum": bedroom_min,
            })
        if "bath" in label or "baño" in label or "bathroom" in label:
            checks.append({
                "rule": "bathroom_min_area",
                "room": room["label"],
                "result": "pass" if area >= bathroom_min else "fail",
                "value": area,
                "minimum": bathroom_min,
            })
        checks.append({
            "rule": "room_window_presence",
            "room": room["label"],
            "result": "pass" if windows else "warn",
            "windows": len(windows),
        })
        checks.append({
            "rule": "room_aspect_ratio",
            "room": room["label"],
            "result": "pass" if ratio <= float(rules.get("room_aspect_ratio_max", 2.0)) else "warn",
            "value": round(ratio, 3),
            "maximum": float(rules.get("room_aspect_ratio_max", 2.0)),
        })

    return checks, _score_from_checks(checks)
