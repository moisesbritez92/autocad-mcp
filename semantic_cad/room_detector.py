from __future__ import annotations

from typing import Any

from .geometry_utils import (
    as_point,
    bounding_box,
    centroid,
    point_in_bbox,
    polygon_area,
    polygon_perimeter,
)


def detect_rooms(context: dict[str, Any]) -> list[dict[str, Any]]:
    entities = context.get("entities", [])
    text_entities = [
        e for e in entities if e.get("type") in {"TEXT", "MTEXT"} and e.get("text")
    ]
    closed_polys = [
        e
        for e in entities
        if e.get("type") == "LWPOLYLINE"
        and e.get("closed") is True
        and e.get("vertices")
        and float(e.get("area") or 0) > 0.4
    ]

    rooms: list[dict[str, Any]] = []
    used_poly_handles: set[str] = set()

    for idx, text in enumerate(text_entities, start=1):
        pos = as_point(text["position"])
        chosen = None
        for poly in closed_polys:
            if poly.get("handle") in used_poly_handles:
                continue
            pts = [as_point(v) for v in poly.get("vertices", [])]
            bb = bounding_box(pts)
            if point_in_bbox(pos, bb):
                chosen = poly
                break

        if chosen is None:
            continue

        pts = [as_point(v) for v in chosen.get("vertices", [])]
        room = {
            "id": f"room_{idx}",
            "label": text.get("text"),
            "polygon": [[x, y] for x, y in pts],
            "area": round(polygon_area(pts), 3),
            "perimeter": round(polygon_perimeter(pts), 3),
            "centroid": [round(v, 3) for v in centroid(pts)],
            "bounding_box": [round(v, 3) for v in bounding_box(pts)],
            "source_text_handle": text.get("handle"),
            "source_poly_handle": chosen.get("handle"),
            "connected_doors": [],
            "connected_windows": [],
            "adjacent_rooms": [],
        }
        rooms.append(room)
        used_poly_handles.add(chosen.get("handle"))

    return rooms
