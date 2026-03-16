from __future__ import annotations

from math import hypot
from typing import Iterable, Sequence

Point = tuple[float, float]


def distance(a: Point, b: Point) -> float:
    return hypot(a[0] - b[0], a[1] - b[1])


def polygon_area(points: Sequence[Point]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for i, p1 in enumerate(points):
        p2 = points[(i + 1) % len(points)]
        total += p1[0] * p2[1] - p2[0] * p1[1]
    return abs(total) / 2.0


def polygon_perimeter(points: Sequence[Point]) -> float:
    if len(points) < 2:
        return 0.0
    total = 0.0
    for i, p1 in enumerate(points):
        p2 = points[(i + 1) % len(points)]
        total += distance(p1, p2)
    return total


def centroid(points: Sequence[Point]) -> Point:
    if not points:
        return (0.0, 0.0)
    x = sum(p[0] for p in points) / len(points)
    y = sum(p[1] for p in points) / len(points)
    return (x, y)


def bounding_box(points: Sequence[Point]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_bbox(point: Point, bbox: tuple[float, float, float, float]) -> bool:
    x, y = point
    xmin, ymin, xmax, ymax = bbox
    return xmin <= x <= xmax and ymin <= y <= ymax


def bbox_center(bbox: tuple[float, float, float, float]) -> Point:
    xmin, ymin, xmax, ymax = bbox
    return ((xmin + xmax) / 2.0, (ymin + ymax) / 2.0)


def bbox_from_entity(entity: dict) -> tuple[float, float, float, float] | None:
    bbox = entity.get("bbox")
    if not bbox:
        return None
    mn = bbox.get("min")
    mx = bbox.get("max")
    if not mn or not mx:
        return None
    return (float(mn["x"]), float(mn["y"]), float(mx["x"]), float(mx["y"]))


def as_point(obj: dict | Sequence[float]) -> Point:
    if isinstance(obj, dict):
        return (float(obj["x"]), float(obj["y"]))
    return (float(obj[0]), float(obj[1]))


def nearest_item(point: Point, items: Iterable[dict], point_getter) -> dict | None:
    best = None
    best_d = float("inf")
    for item in items:
        p = point_getter(item)
        d = distance(point, p)
        if d < best_d:
            best = item
            best_d = d
    return best
