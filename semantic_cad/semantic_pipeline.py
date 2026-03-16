from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .block_library import load_block_index
from .opening_detector import attach_openings_to_rooms, detect_openings, infer_room_connections
from .room_detector import detect_rooms
from .rules_loader import load_architecture_rules
from .topology_builder import build_topology_graph
from .validation_rules import validate_rooms


RULES_PATH = Path(__file__).resolve().parent.parent / "rules" / "architecture_rules.md"


def infer_agent_hints(context: dict[str, Any], rooms: list[dict[str, Any]], openings: dict[str, list[dict[str, Any]]], scores: dict[str, float]) -> dict[str, Any]:
    room_labels = [r.get("label", "") for r in rooms]
    building_type = "small_residential_unit" if len(room_labels) >= 3 else "undetermined"
    layout_type = "linear" if any("hall" in (label or "").lower() for label in room_labels) else "compact"
    circulation_core = next((r["label"] for r in rooms if "hall" in (r.get("label") or "").lower()), None)
    confidence = max(0.45, min(0.95, scores.get("design_score", 0.5)))
    return {
        "building_type": building_type,
        "estimated_rooms": len(rooms),
        "circulation_core": circulation_core,
        "layout_type": layout_type,
        "confidence": round(confidence, 2),
    }


def build_wall_summary(context: dict[str, Any]) -> list[dict[str, Any]]:
    entities = context.get("entities", [])
    walls = []
    for idx, ent in enumerate([e for e in entities if e.get("category") == "walls"], start=1):
        length = ent.get("length")
        orientation = "unknown"
        if ent.get("start") and ent.get("end"):
            dx = abs(float(ent["start"]["x"]) - float(ent["end"]["x"]))
            dy = abs(float(ent["start"]["y"]) - float(ent["end"]["y"]))
            orientation = "horizontal" if dx >= dy else "vertical"
        walls.append({
            "id": f"wall_{idx}",
            "type": "exterior" if idx == 1 else "interior",
            "length": length,
            "orientation": orientation,
            "source_handle": ent.get("handle"),
        })
    return walls


def build_relationships(rooms: list[dict[str, Any]], room_connections: list[dict[str, Any]], openings: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return {
        "room_connections": room_connections,
        "room_openings": [
            {
                "room": room["label"],
                "doors": room.get("connected_doors", []),
                "windows": room.get("connected_windows", []),
            }
            for room in rooms
        ],
    }


def enrich_context(context: dict[str, Any]) -> dict[str, Any]:
    ruleset = load_architecture_rules(RULES_PATH)
    rooms = detect_rooms(context)
    openings = detect_openings(context)
    attach_openings_to_rooms(rooms, openings)
    room_connections = infer_room_connections(rooms, openings)
    topology_graph = build_topology_graph(rooms, room_connections)
    validation, scores = validate_rooms(rooms, ruleset)
    walls = build_wall_summary(context)
    relationships = build_relationships(rooms, room_connections, openings)
    agent_hints = infer_agent_hints(context, rooms, openings, scores)

    enriched = dict(context)
    enriched["rooms"] = rooms
    enriched["relationships"] = relationships
    enriched["openings"] = openings
    enriched["walls"] = walls
    enriched["topology_graph"] = topology_graph
    enriched["validation"] = validation
    enriched["design_quality"] = scores
    enriched["agent_hints"] = agent_hints
    enriched["rules_reference"] = {
        "path": ruleset.get("path"),
        "principles": ruleset.get("principles", []),
        "loaded": ruleset.get("loaded", False),
    }
    enriched["block_library"] = load_block_index()
    return enriched


def build_markdown_summary(data: dict[str, Any]) -> str:
    summary = data.get("summary", {})
    rooms = data.get("rooms", [])
    openings = data.get("openings", {})
    validation = data.get("validation", [])
    hints = data.get("agent_hints", {})
    quality = data.get("design_quality", {})
    rules_ref = data.get("rules_reference", {})

    lines = []
    lines.append(f"# Resumen del plano: {summary.get('drawingName', 'sin nombre')}")
    lines.append("")
    lines.append("## Hallazgos clave")
    lines.append(f"- Entidades totales: {summary.get('entityCount')}")
    lines.append(f"- Habitaciones detectadas heurísticamente: {len(rooms)}")
    lines.append(f"- Puertas detectadas: {len(openings.get('doors', []))}")
    lines.append(f"- Ventanas detectadas: {len(openings.get('windows', []))}")
    lines.append(f"- Tipo de edificio estimado: {hints.get('building_type')}")
    lines.append(f"- Layout estimado: {hints.get('layout_type')}")
    if hints.get("circulation_core"):
        lines.append(f"- Núcleo de circulación estimado: {hints.get('circulation_core')}")
    lines.append("")

    lines.append("## Calidad arquitectónica")
    if quality:
        for key, value in quality.items():
            lines.append(f"- {key}: {value}")
    else:
        lines.append("- Sin scoring disponible.")
    lines.append("")

    if rooms:
        lines.append("## Habitaciones")
        for room in rooms:
            lines.append(
                f"- {room['label']}: área aprox. {room['area']} m², perímetro {room['perimeter']} m, puertas={len(room['connected_doors'])}, ventanas={len(room['connected_windows'])}"
            )
        lines.append("")

    room_connections = data.get("relationships", {}).get("room_connections", [])
    lines.append("## Conexiones")
    if room_connections:
        for conn in room_connections:
            lines.append(f"- {conn['from']} → {conn['to']} vía {conn['via']}")
    else:
        lines.append("- No se pudieron inferir conexiones completas entre habitaciones con alta confianza.")
    lines.append("")

    lines.append("## Validaciones")
    if validation:
        for item in validation:
            room = item.get("room")
            rule = item.get("rule")
            result = item.get("result")
            lines.append(f"- {rule} / {room}: {result}")
    else:
        lines.append("- Sin validaciones disponibles.")
    lines.append("")

    lines.append("## Reglas de referencia")
    lines.append(f"- Archivo: {rules_ref.get('path')}")
    for principle in rules_ref.get("principles", []):
        lines.append(f"- {principle}")
    lines.append("")

    lines.append("## Ambigüedades")
    lines.append("- La detección de habitaciones y conexiones es heurística y depende de contornos cerrados y etiquetas presentes.")
    lines.append("- Si faltan bloques, arcos o etiquetas, algunas relaciones pueden quedar incompletas.")
    lines.append("")
    return "\n".join(lines)


def _read_json_fallback(path: Path) -> dict[str, Any]:
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return json.loads(path.read_text(encoding=enc))
        except Exception:
            pass
    raise ValueError(f"Could not decode JSON file: {path}")


def run(input_path: str | Path, output_json: str | Path, output_md: str | Path) -> dict[str, Any]:
    input_path = Path(input_path)
    output_json = Path(output_json)
    output_md = Path(output_md)

    context = _read_json_fallback(input_path)
    enriched = enrich_context(context)
    output_json.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    output_md.write_text(build_markdown_summary(enriched), encoding="utf-8")
    return enriched
