# AutoCAD MCP Server & Plugin

Model Context Protocol (MCP) server for **Autodesk AutoCAD 2026**.
Two modes of operation:
1.  **Headless** — `accoreconsole.exe` runs `.scr` / `.lsp` scripts against `.dwg` files (batch / CI).
2.  **Live Plugin** — .NET plugin loaded into AutoCAD, communicated via HTTP on `localhost:12345`.

## Project Structure

```
src/              Node.js MCP Server (TypeScript)
autocad-plugin/   C# .NET Plugin for AutoCAD 2026
scripts/          Automation scripts (.scr, .lsp)
blocks/           Block library (.dwg) with index.json
outputs/          Generated DWG/PDF outputs
semantic_cad/     Python semantic analysis pipeline
rules/            Architecture validation rules
```

## Prerequisites

-   **Node.js** v18+
-   **Autodesk AutoCAD 2026**
-   **.NET SDK 8.0** (for building the plugin)

## Setup

### 1. Build the Node.js Server
```bash
npm install
npm run build
```

### 2. Build the AutoCAD Plugin
```bash
cd autocad-plugin
dotnet build -c Release
```
Output: `autocad-plugin/bin/Release/net8.0-windows/AutoCAD.MCP.Plugin.dll`

### 3. Load Plugin into AutoCAD
1. Open AutoCAD 2026.
2. Type `NETLOAD` command.
3. Select `AutoCAD.MCP.Plugin.dll` from step 2.
4. Set env var: `setx MCP_AUTOCAD_TOKEN "default-secret-token"` (restart AutoCAD after).
5. Wait for: `[MCP] Server listening on http://localhost:12345/`.

## Usage

```bash
npm start
```

### Available Tools (45 total)

#### Geometry Creation (10)
| Tool | Description |
|------|-------------|
| `create_line` | Line from two points |
| `create_circle` | Circle by center + radius |
| `create_arc` | Arc by center, radius, start/end angles |
| `create_polyline` | Polyline with optional bulge (arcs) |
| `create_rectangle` | Rectangle from two corners |
| `create_ellipse` | Ellipse by center + radii |
| `create_spline` | Spline through fit points |
| `create_hatch` | Hatch fill inside boundary entities |
| `create_mtext` | Multiline text (MText) |
| `create_text` | Single-line text (DBText) |

#### Query & Measurement (6)
| Tool | Description |
|------|-------------|
| `query_entities` | Search by type/layer with limit |
| `get_entity_properties` | Full properties by handle |
| `measure_distance` | Distance between two points |
| `measure_area` | Area & perimeter of closed entity |
| `count_entities` | Count + breakdown by type/layer |
| `get_drawing_extents` | Bounding box of all entities |

#### Modify & Transform (9)
| Tool | Description |
|------|-------------|
| `move_entities` | Translate by delta vector |
| `rotate_entities` | Rotate around base point |
| `scale_entities` | Scale from base point |
| `copy_entities` | Duplicate with offset |
| `mirror_entities` | Mirror across axis line |
| `offset_entity` | Offset curve at distance |
| `erase_entities` | Delete by handles |
| `change_layer` | Move entities to layer |
| `change_color` | Change ACI color |

#### Block Management (5)
| Tool | Description |
|------|-------------|
| `insert_block` | Insert block by name/path |
| `list_blocks` | List definitions in drawing |
| `list_available_blocks` | List blocks from library |
| `explode_block` | Explode into components |
| `get_block_attributes` / `set_block_attribute` | Read/write attributes |

#### Dimensions & Annotations (6)
| Tool | Description |
|------|-------------|
| `add_linear_dimension` | H/V/auto dimension |
| `add_aligned_dimension` | Aligned dimension |
| `add_radial_dimension` | Radius dimension on circle/arc |
| `create_leader` | Leader with text |
| `create_table` | Table with data |
| `update_text` | Modify existing text |

#### Layer Management (5)
| Tool | Description |
|------|-------------|
| `get_layers` | List all layers + properties |
| `create_layer` | Create layer with color/weight |
| `set_layer_properties` | Modify on/off/freeze/lock/color |
| `delete_layer` | Remove layer |
| `set_current_layer` | Set active layer |

#### Document & Export (6)
| Tool | Description |
|------|-------------|
| `save_drawing` | Save or Save As |
| `zoom_extents` | Zoom to fit all entities |
| `undo` | Undo N operations |
| `run_command` | Raw command / LISP expression |
| `export_to_pdf` | DWG → PDF (headless) |
| `export_to_dxf` | DWG → DXF (headless) |

#### Batch & Generation (3)
| Tool | Description |
|------|-------------|
| `execute_script_file` | Run .scr on .dwg (headless) |
| `list_available_scripts` | List .scr/.lsp in scripts dir |
| `generate_house_plan` | NL → full floor plan DWG |

### Prompts

-   **`house_generator`** — Guides the assistant to call `generate_house_plan`.

## Quick Example

```json
{
  "name": "house_generator",
  "arguments": {
    "bedrooms": "3",
    "bathrooms": "2",
    "lot_width": "12",
    "lot_depth": "9",
    "style": "open",
    "requirements": "Incluye terraza trasera y cocina integrada"
  }
}
```

## Configuration (.env)

```env
AUTOCAD_CONSOLE_PATH="C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe"
AUTOCAD_SCRIPTS_DIR="./scripts"
AUTOCAD_PLUGIN_URL="http://localhost:12345"
MCP_AUTOCAD_TOKEN="default-secret-token"
```
