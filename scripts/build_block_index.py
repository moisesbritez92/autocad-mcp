from pathlib import Path
import sys

base = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base))

from semantic_cad.block_library import build_block_index


if __name__ == "__main__":
    result = build_block_index()
    print(f"Indexed {result['count']} block(s) into {base / 'blocks' / 'index.json'}")
