# AutoCAD MCP Server & Plugin

This project implements a Model Context Protocol (MCP) server for Autodesk AutoCAD 2026.
It supports two modes of operation:
1.  **Headless Execution**: Using `accoreconsole.exe` to run `.scr` and `.lsp` scripts against `.dwg` files.
2.  **Live Interaction**: Using a custom .NET Plugin loaded into AutoCAD to execute commands in real-time.

## Project Structure

-   `src/`: Node.js MCP Server (TypeScript).
-   `autocad-plugin/`: C# .NET Plugin for AutoCAD 2026.
-   `scripts/`: Automation scripts directory.

## Prerequisites

-   **Node.js** (v18+)
-   **Autodesk AutoCAD 2026**
-   **.NET SDK 8.0** (for building the plugin)

## Setup

### 1. Build the Node.js Server
```bash
npm install
npm run build
```

### 2. Build the AutoCAD Plugin
Open `autocad-plugin/AutoCAD.MCP.Plugin.csproj` in Visual Studio or use CLI:
```bash
cd autocad-plugin
dotnet build -c Release
```
This will produce a DLL at `autocad-plugin/bin/Release/net8.0-windows/AutoCAD.MCP.Plugin.dll`.

### 3. Load Plugin into AutoCAD
1.  Open AutoCAD 2026.
2.  Type `NETLOAD` command.
3.  Select the `AutoCAD.MCP.Plugin.dll` built in step 2.
4.  Set Environment Variable: `setx MCP_AUTOCAD_TOKEN "default-secret-token"` (restart AutoCAD after).
5.  Wait for the message: `[MCP] Server listening on http://localhost:12345/`.

## Usage

Start the MCP Server:
```bash
npm start
```

### Available Tools

-   **`create_line`**: Create a line in the active document.
    -   Args: `startX`, `startY`, `endX`, `endY`
-   **`get_layers`**: List all layers.
-   **`create_layer`**: Create a new layer.
-   **`execute_script_file`**: Run a .scr file on a .dwg (headless).

### Available Prompts

-   **`house_generator`**: Prompt template that guides the assistant to call `generate_house_plan`.
        -   Optional args: `bedrooms`, `bathrooms`, `lot_width`, `lot_depth`, `style`, `requirements`, `output_path`.
        -   Example defaults generate: `Casa de 3 dormitorios, 2 banos, lote 10x8, estilo linear`.

## Quick Example (Prompt -> House)

From any MCP client that supports prompts:
1. Request prompt list (`prompts/list`) and select `house_generator`.
2. Request prompt content (`prompts/get`) with args, for example:

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

3. Execute the returned instruction; it will call `generate_house_plan` with a ready payload.

## Configuration (.env)

```env
AUTOCAD_CONSOLE_PATH="C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe"
AUTOCAD_SCRIPTS_DIR="./scripts"
AUTOCAD_PLUGIN_URL="http://localhost:12345"
MCP_AUTOCAD_TOKEN="default-secret-token"
```
