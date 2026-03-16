from pathlib import Path
import sys

base = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(base))

from semantic_cad.semantic_pipeline import run


if __name__ == "__main__":
    input_json = base / "outputs" / "plano-contexto.json"
    output_json = base / "outputs" / "plano-contexto.semantic.json"
    output_md = base / "outputs" / "plano-resumen.md"
    run(input_json, output_json, output_md)
    print(f"Semantic JSON written to: {output_json}")
    print(f"Markdown summary written to: {output_md}")
