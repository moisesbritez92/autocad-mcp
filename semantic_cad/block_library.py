from __future__ import annotations

import json
from pathlib import Path
from typing import Any


BLOCKS_DIR = Path(__file__).resolve().parent.parent / "blocks"
INDEX_PATH = BLOCKS_DIR / "index.json"


def infer_category(path: Path) -> str:
    return path.parent.name


def infer_block_name(path: Path) -> str:
    return path.stem


def build_block_index(blocks_dir: str | Path = BLOCKS_DIR, output_path: str | Path = INDEX_PATH) -> dict[str, Any]:
    blocks_dir = Path(blocks_dir)
    output_path = Path(output_path)

    items: list[dict[str, Any]] = []
    for file in sorted(blocks_dir.rglob("*.dwg")):
        items.append(
            {
                "name": infer_block_name(file),
                "category": infer_category(file),
                "path": str(file),
                "size_bytes": file.stat().st_size,
            }
        )

    index = {
        "root": str(blocks_dir),
        "count": len(items),
        "blocks": items,
        "by_category": _category_counts(items),
    }
    output_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index


def _category_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for item in items:
        cat = item["category"]
        out[cat] = out.get(cat, 0) + 1
    return out


def load_block_index(index_path: str | Path = INDEX_PATH) -> dict[str, Any]:
    index_path = Path(index_path)
    if not index_path.exists():
        return build_block_index()
    return json.loads(index_path.read_text(encoding="utf-8"))


def find_blocks(category: str | None = None, name_contains: str | None = None) -> list[dict[str, Any]]:
    index = load_block_index()
    blocks = index.get("blocks", [])
    if category:
        blocks = [b for b in blocks if b.get("category") == category]
    if name_contains:
        q = name_contains.lower()
        blocks = [b for b in blocks if q in b.get("name", "").lower()]
    return blocks
