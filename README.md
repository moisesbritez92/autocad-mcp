# AutoCAD MCP Server

This is a Model Context Protocol (MCP) server that allows AI assistants to interact with **Autodesk AutoCAD**.

It uses the **AutoCAD Core Console** (`accoreconsole.exe`) to execute automation scripts (`.scr`) and AutoLISP (`.lsp`) files against drawing files (`.dwg`).

## Prerequisites

-   **Node.js** (v16 or higher)
-   **Autodesk AutoCAD** installed (tested with 2026, but should work with older versions that have `accoreconsole.exe`).

## Configuration

1.  Copy `.env.example` to `.env`.
2.  Update `AUTOCAD_CONSOLE_PATH` to point to your `accoreconsole.exe`.
    -   Usually: `C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe`
3.  Place your automation scripts in the `scripts/` directory (or configure `AUTOCAD_SCRIPTS_DIR`).

## Usage

### Install Dependencies
```bash
npm install
```

### Build & Start
```bash
npm run build
npm start
```

### Available Tools
-   **`list_available_scripts`**: Returns a list of scripts in your configured directory.
-   **`execute_script`**: Runs a script on a specific drawing.
    -   Arguments:
        -   `drawingPath`: Full path to the `.dwg`.
        -   `scriptPath`: Full path to the `.scr`.
