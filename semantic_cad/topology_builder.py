from __future__ import annotations

from typing import Any


def build_topology_graph(rooms: list[dict[str, Any]], room_connections: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = [room["id"] for room in rooms]
    edges = []
    for conn in room_connections:
        frm = conn["from"].lower().replace(" ", "_")
        to = conn["to"].lower().replace(" ", "_")
        edges.append({"from": frm, "to": to, "via": conn["via"]})
    return {"nodes": nodes, "edges": edges}
