# AutoCAD MCP Server & Plugin Implementation Plan

## Goal
Transform the current `accoreconsole` wrapper into a full bidirectional integration between an MCP Server (Node.js) and an AutoCAD .NET Plugin (C#).

## Architecture
- **MCP Server (Node.js)**:
  - Acts as the client to the AutoCAD plugin.
  - Exposes MCP tools (`create_line`, `get_layers`, etc.).
  - Sends HTTP requests to `http://localhost:8080` (or similar).
  - Authenticates via `MCP_AUTOCAD_TOKEN`.
- **AutoCAD Plugin (C# .NET)**:
  - Loads into AutoCAD via `NETLOAD`.
  - Starts a local HTTP server (using `HttpListener`).
  - Listens for commands from the MCP server.
  - Executes AutoCAD API commands (`Transaction`, `BlockTable`, etc.) on the main thread (using proper locking/marshaling).

## Todo List

### Phase 1: restructuring & Cleanup
- [ ] Move existing `src/index.ts` logic to a legacy handler or remove if obsolete (we will replace `execute_script` logic with API calls where possible, but might keep it as a fallback).
- [ ] Create `autocad-plugin` directory structure.

### Phase 2: C# Plugin Implementation (The "Server")
- [ ] Create `.csproj` for AutoCAD 2026 (.NET 8.0 or .NET Framework 4.8 depending on AutoCAD version - ACAD 2025+ usually moves to .NET 8).
- [ ] Implement `Plugin.cs`:
  - `IExtensionApplication.Initialize()`: Start HTTP server.
  - `IExtensionApplication.Terminate()`: Stop HTTP server.
- [ ] Implement `HttpServer.cs`:
  - Handle POST requests to `/api/command`.
  - Validate `Authorization` header.
  - Dispatch to `CommandProcessor.cs`.
- [ ] Implement `CommandProcessor.cs`:
  - `CreateLine(start, end, layer)`
  - `GetLayers()`
  - `CreateLayer(name, color)`
  - `ExecuteCommand(cmd)`
- [ ] Ensure Main Thread execution (AutoCAD API requires this).

### Phase 3: Node.js MCP Server Implementation (The "Client")
- [ ] Install `axios` or use `fetch`.
- [ ] Create `src/autocadClient.ts`:
  - Helper to send requests to localhost plugin.
  - Handle connection errors (e.g., AutoCAD not running).
- [ ] Update `src/index.ts`:
  - Define new MCP Tools mapping to plugin endpoints.
  - `create_line`, `create_polyline`, `create_layer`, `get_layers`, `insert_block`, `run_command`.
  - Keep `execute_script` as a tool but maybe route it through the plugin or keep using `accoreconsole`? (Plugin is better for active drawing, console for batch). Let's focus on Plugin for "Active Document" operations.

### Phase 4: Build & Documentation
- [ ] Create build script for C# (dotnet build).
- [ ] Update README with instructions on how to `NETLOAD` the DLL.
- [ ] Add usage examples.

## Technical Details
- **Port**: 3000 (default) for MCP, maybe 12345 for AutoCAD Plugin?
- **Security**: Simple Bearer token.
