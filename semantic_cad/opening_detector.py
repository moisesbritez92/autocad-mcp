from __future__ import annotations

from typing import Any

from .geometry_utils import as_point, distance


def detect_openings(context: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    entities = context.get("entities", [])
    inserts = [e for e in entities if e.get("type") == "INSERT"]
    doors = []
    windows = []

    for idx, ent in enumerate(inserts, start=1):
        cat = ent.get("blockCategory") or ent.get("category")
        pos = as_point(ent.get("position", {"x": 0, "y": 0}))
        item = {
            "id": f"{cat[:-1] if cat and cat.endswith('s') else cat or 'opening'}_{idx}",
            "name": ent.get("blockName"),
            "position": [round(pos[0], 3), round(pos[1], 3)],
            "rotation": round(float(ent.get("rotation") or 0), 3),
            "width": round(float(ent.get("xScale") or 1.0), 3),
            "attributes": ent.get("attributes", []),
            "source_handle": ent.get("handle"),
        }
        if cat == "doors":
            item["swing_angle"] = 90
            doors.append(item)
        elif cat == "windows":
            item["classification"] = "unknown"
            windows.append(item)

    return {"doors": doors, "windows": windows}


def attach_openings_to_rooms(rooms: list[dict[str, Any]], openings: dict[str, list[dict[str, Any]]]) -> None:
    for room in rooms:
        xmin, ymin, xmax, ymax = room["bounding_box"]
        cx, cy = room["centroid"]

        for door in openings.get("doors", []):
            x, y = door["position"]
            margin = 1.2
            if (xmin - margin) <= x <= (xmax + margin) and (ymin - margin) <= y <= (ymax + margin):
                room["connected_doors"].append(door["id"])

        for window in openings.get("windows", []):
            x, y = window["position"]
            margin = 1.0
            if (xmin - margin) <= x <= (xmax + margin) and (ymin - margin) <= y <= (ymax + margin):
                room["connected_windows"].append(window["id"])


def infer_room_connections(rooms: list[dict[str, Any]], openings: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    room_connections = []
    for door in openings.get("doors", []):
        attached = []
        x, y = door["position"]
        for room in rooms:
            xmin, ymin, xmax, ymax = room["bounding_box"]
            margin = 1.2
            if (xmin - margin) <= x <= (xmax + margin) and (ymin - margin) <= y <= (ymax + margin):
                attached.append(room)

        if len(attached) >= 2:
            a, b = attached[0], attached[1]
            room_connections.append({"from": a["label"], "to": b["label"], "via": door["id"]})
            a["adjacent_rooms"].append(b["id"])
            b["adjacent_rooms"].append(a["id"])
        elif len(attached) == 1:
            room_connections.append({"from": attached[0]["label"], "to": "outside", "via": door["id"]})
    return room_connections
