import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";
import { Buffer } from "buffer";
import { sendAutoCADCommand } from "./autocadClient.js";
import { resolveHouseSpec } from "./nlpParser.js";
import { generateLayout } from "./layoutEngine.js";
import { generateLSP, writeLSPToTemp, writeRunScript } from "./lspGenerator.js";

// Load environment variables
dotenv.config();

// Configuration
// Try to find AutoCAD Core Console or use environment variable
const AUTOCAD_CONSOLE_PATH = process.env.AUTOCAD_CONSOLE_PATH || "C:\\Program Files\\Autodesk\\AutoCAD 2026\\accoreconsole.exe";
const SCRIPTS_DIR = process.env.AUTOCAD_SCRIPTS_DIR || path.join(process.cwd(), "scripts");
const BLOCKS_DIR = process.env.AUTOCAD_BLOCKS_DIR || path.join(process.cwd(), "blocks");
const TEMP_DIR = process.env.AUTOCAD_TEMP_DIR || path.join(process.cwd(), "temp");
const OUTPUTS_DIR = process.env.AUTOCAD_OUTPUTS_DIR || path.join(process.cwd(), "outputs");
const SEMANTIC_SCRIPT = process.env.SEMANTIC_EXTRACT_SCRIPT || path.join(process.cwd(), "scripts", "semantic_extract.py");
const HOUSE_PROMPT_NAME = "house_generator";

const execAsync = promisify(exec);

function decodeAutoCADOutput(output: string | Buffer | null | undefined): string {
  if (output == null) return "";

  if (Buffer.isBuffer(output)) {
    const utf16 = output.toString("utf16le").replace(/\u0000/g, "").trim();
    if (utf16) return utf16;
    return output.toString("utf8").replace(/\u0000/g, "").trim();
  }

  if (typeof output === "string") {
    if (output.includes("\u0000") || output.includes("\0")) {
      return output.replace(/\u0000|\0/g, "").trim();
    }
    return output.trim();
  }

  return String(output).trim();
}

function cleanAutoCADOutput(output: string): string {
  if (!output) return "";

  const noisePatterns = [
    /^Redirect stdout /i,
    /^AcCoreConsole: /i,
    /^AutoCAD Core Engine Console /i,
    /^Execution Path:/i,
    /^[A-Z]:\\Program Files\\Autodesk\\.*accoreconsole\.exe$/i,
    /^Current Directory:/i,
    /^Version Number:/i,
    /^LogFilePath has been set to the working folder\.?$/i,
    /^LogFilePath has been restored to .*$/i,
    /^CoreHeartBeat$/i,
    /^Regenerating model\.?$/i,
    /^Loading Modeler DLLs\.?$/i,
    /^\*\*\*\* System Variable Changed \*\*\*\*$/i,
    /^1 of the monitored system variables has changed from the preferred value\..*$/i,
    /^AutoCAD menu utilities loaded\.?$/i,
    /^Command:$/i
  ];

  const cleanedLines = output
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== "")
    .filter(line => !noisePatterns.some(pattern => pattern.test(line)));

  return cleanedLines.join("\n").trim();
}

function summarizeExecution(stdout: string, stderr: string, hadError = false): string {
  const combined = `${stdout}\n${stderr}`.trim();
  const lines = combined.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  const successHints = [
    /loaded successfully!?/i,
    /completed successfully/i,
    /success/i
  ];

  const failureHints = [
    /error/i,
    /exception/i,
    /invalid/i,
    /failed/i,
    /fatal/i,
    /not found/i
  ];

  const successLine = lines.find(line => successHints.some(pattern => pattern.test(line)));
  const failureLine = lines.find(line => failureHints.some(pattern => pattern.test(line)));

  if (hadError || failureLine) {
    return `Summary: FAILED${failureLine ? ` — ${failureLine}` : ""}`;
  }

  if (successLine) {
    return `Summary: OK — ${successLine}`;
  }

  if (stdout && !stderr) {
    return "Summary: OK — command completed with output";
  }

  if (!stdout && !stderr) {
    return "Summary: OK — no output";
  }

  return "Summary: OK — command completed";
}

const server = new Server(
  {
    name: "autocad-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      prompts: {},
      tools: {},
    },
  }
);

/**
 * Helper to list script files in a directory
 */
async function listScripts(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    // Check if directory exists first
    try {
      await fs.access(dir);
    } catch {
      return [];
    }

    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const file of list) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        const subResults = await listScripts(fullPath);
        results.push(...subResults);
      } else if (file.name.endsWith(".scr") || file.name.endsWith(".lsp")) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error listing scripts in ${dir}:`, error);
  }
  return results;
}

// Handler for listing resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const scripts = await listScripts(SCRIPTS_DIR);
  
  return {
    resources: scripts.map(scriptPath => ({
      uri: `autocad://scripts/${path.basename(scriptPath)}`,
      name: path.basename(scriptPath),
      mimeType: "text/plain",
      description: `AutoCAD Script: ${scriptPath}`
    }))
  };
});

// Handler for reading resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  if (url.protocol !== "autocad:" || url.pathname.indexOf("/scripts/") !== 0) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid URI: ${request.params.uri}`);
  }

  const scriptName = path.basename(url.pathname);
  // Scan to find the full path again (security: prevent path traversal)
  const scripts = await listScripts(SCRIPTS_DIR);
  const foundScript = scripts.find(s => path.basename(s) === scriptName);

  if (!foundScript) {
    throw new McpError(ErrorCode.InvalidRequest, `Script not found: ${scriptName}`);
  }

  const content = await fs.readFile(foundScript, "utf-8");
  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: content
    }]
  };
});

// Prompt templates for MCP clients
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: HOUSE_PROMPT_NAME,
        title: "Generar Casa 2D en AutoCAD",
        description: "Construye un prompt guiado para generar una casa usando la tool generate_house_plan.",
        arguments: [
          { name: "bedrooms", description: "Cantidad de dormitorios (ej. 3)", required: false },
          { name: "bathrooms", description: "Cantidad de banos (ej. 2)", required: false },
          { name: "lot_width", description: "Ancho del lote en metros (ej. 10)", required: false },
          { name: "lot_depth", description: "Fondo del lote en metros (ej. 8)", required: false },
          { name: "style", description: "Estilo de distribucion: compact | linear | open", required: false },
          { name: "requirements", description: "Requisitos extra en lenguaje natural", required: false },
          { name: "output_path", description: "Ruta completa opcional del DWG de salida", required: false }
        ]
      }
    ]
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== HOUSE_PROMPT_NAME) {
    throw new McpError(ErrorCode.InvalidParams, `Prompt not found: ${request.params.name}`);
  }

  const args = request.params.arguments ?? {};
  const bedrooms = args.bedrooms ?? "3";
  const bathrooms = args.bathrooms ?? "2";
  const lotWidth = args.lot_width ?? "10";
  const lotDepth = args.lot_depth ?? "8";
  const style = args.style ?? "linear";
  const requirements = args.requirements ?? "Cocina-sala integrada y buena ventilacion";
  const outputPath = args.output_path;

  const description = `Casa de ${bedrooms} dormitorios, ${bathrooms} banos, lote ${lotWidth}x${lotDepth}, estilo ${style}. ${requirements}`.trim();

  const payload = {
    description,
    lot_width: Number(lotWidth),
    lot_depth: Number(lotDepth),
    style,
    ...(typeof outputPath === "string" && outputPath ? { output_path: outputPath } : {})
  };

  return {
    description: "Prompt para generar una casa en AutoCAD mediante generate_house_plan.",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Genera una casa 2D en AutoCAD usando la tool generate_house_plan.",
            "No inventes herramientas ni comandos fuera del MCP disponible.",
            "Usa exactamente este payload JSON como argumentos:",
            JSON.stringify(payload, null, 2),
            "Despues de ejecutar, resume capas, habitaciones y ruta final del DWG generado."
          ].join("\n\n")
        }
      }
    ]
  };
});

// Handler for listing tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_script_file",
        description: "Executes an AutoCAD script (.scr) against a drawing (.dwg) using accoreconsole (headless). Best for batch processing.",
        inputSchema: {
          type: "object",
          properties: {
            drawingPath: {
              type: "string",
              description: "Full path to the .dwg file to process"
            },
            scriptPath: {
              type: "string",
              description: "Full path to the .scr script to run"
            },
            timeout: {
                type: "number",
                description: "Timeout in seconds (default: 60)"
            }
          },
          required: ["drawingPath", "scriptPath"]
        }
      },
      {
        name: "list_available_scripts",
        description: "Lists all available .scr and .lsp files in the configured scripts directory.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "create_line",
        description: "Creates a line in the active AutoCAD document (requires running Plugin).",
        inputSchema: {
          type: "object",
          properties: {
            startX: { type: "number", description: "Start X coordinate" },
            startY: { type: "number", description: "Start Y coordinate" },
            endX: { type: "number", description: "End X coordinate" },
            endY: { type: "number", description: "End Y coordinate" }
          },
          required: ["startX", "startY", "endX", "endY"]
        }
      },
      {
        name: "get_layers",
        description: "Gets a list of all layers in the active AutoCAD document.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "create_layer",
        description: "Creates a new layer in the active AutoCAD document.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new layer" }
          },
          required: ["name"]
        }
      },
      {
        name: "insert_block",
        description: "Inserts a block (DWG) into the current drawing.",
        inputSchema: {
          type: "object",
          properties: {
            blockName: { type: "string", description: "Name of the block definition." },
            blockPath: { type: "string", description: "Optional full path to DWG file if block is not loaded." },
            x: { type: "number", description: "Insertion X coordinate" },
            y: { type: "number", description: "Insertion Y coordinate" },
            scale: { type: "number", description: "Uniform scale factor (default 1.0)" },
            rotation: { type: "number", description: "Rotation in degrees (default 0.0)" }
          },
          required: ["blockName", "x", "y"]
        }
      },
      {
        name: "run_command",
        description: "Sends a command string to the AutoCAD command line (supports LISP expressions).",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "AutoCAD command or LISP expression (e.g. '(load \"script.lsp\")')" }
          },
          required: ["command"]
        }
      },
      {
        name: "generate_house_plan",
        description: "Generates a complete 2D architectural floor plan in AutoCAD from a natural language description or structured JSON. Applies architecture rules (zones, proportions, lighting), produces wall shells via REGION/SUBTRACT, inserts door/window blocks, labels rooms, and saves a DWG. Returns the drawing path and a semantic summary.",
        inputSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Natural language description (e.g. '3 bedrooms, 2 bathrooms, 10x8 lot') OR a JSON string with HouseSpec fields."
            },
            lot_width:  { type: "number", description: "Lot width in metres (overrides value parsed from description)" },
            lot_depth:  { type: "number", description: "Lot depth in metres (overrides value parsed from description)" },
            rooms: {
              type: "array",
              description: "Explicit room list (overrides parsed rooms)",
              items: {
                type: "object",
                properties: {
                  type:  { type: "string", description: "RoomType: bedroom | master_bedroom | bathroom | half_bath | living_room | living_kitchen | living_dining | dining_room | kitchen | hallway | study | terrace | garage" },
                  count: { type: "number", description: "How many of this room type" },
                  label: { type: "string", description: "Custom label (optional)" }
                },
                required: ["type", "count"]
              }
            },
            style: { type: "string", enum: ["compact", "linear", "open"], description: "Layout style preference" },
            include_terrace: { type: "boolean", description: "Include a rear terrace (default true)" },
            output_path: { type: "string", description: "Full path to the output .dwg file (default: outputs/generated_TIMESTAMP.dwg)" }
          },
          required: ["description"]
        }
      }
    ]
  };
});

// Handler for executing tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // ... existing tools ...

  if (request.params.name === "insert_block") {
      const args = request.params.arguments as any;
      const result = await sendAutoCADCommand("insert_block", args);
      return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
  }

  if (request.params.name === "run_command") {
      const args = request.params.arguments as any;
      const result = await sendAutoCADCommand("run_command", args);
      return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
  }
  if (request.params.name === "list_available_scripts") {
    const scripts = await listScripts(SCRIPTS_DIR);
    return {
      content: [{
        type: "text",
        text: `Available Scripts in ${SCRIPTS_DIR}:\n${scripts.join("\n") || "No scripts found."}`
      }]
    };
  }

  if (request.params.name === "execute_script_file") {
    const drawingPath = String(request.params.arguments?.drawingPath);
    const scriptPath = String(request.params.arguments?.scriptPath);
    const timeoutSec = Number(request.params.arguments?.timeout) || 60;

    if (!drawingPath || !scriptPath) {
      throw new McpError(ErrorCode.InvalidParams, "drawingPath and scriptPath are required");
    }

    // Validation
    try {
        await fs.access(drawingPath);
        await fs.access(scriptPath);
    } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, `File not found: ${drawingPath} or ${scriptPath}`);
    }

    // Construct command
    // accoreconsole.exe /i "drawing.dwg" /s "script.scr"
    const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${drawingPath}" /s "${scriptPath}"`;
    
    console.error(`Executing: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutSec * 1000,
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024
      });

      const cleanStdout = cleanAutoCADOutput(decodeAutoCADOutput(stdout));
      const cleanStderr = cleanAutoCADOutput(decodeAutoCADOutput(stderr));
      const summary = summarizeExecution(cleanStdout, cleanStderr, false);
      
      return {
        content: [
          {
            type: "text",
            text: `Execution Completed.\n${summary}\n\nSTDOUT:\n${cleanStdout || "(no output)"}\n\nSTDERR:\n${cleanStderr || "(no output)"}`
          }
        ]
      };
    } catch (error: any) {
      const cleanStdout = cleanAutoCADOutput(decodeAutoCADOutput(error.stdout));
      const cleanStderr = cleanAutoCADOutput(decodeAutoCADOutput(error.stderr));
      const summary = summarizeExecution(cleanStdout, cleanStderr, true);

      return {
        content: [
          {
            type: "text",
            text: `Error executing script: ${error.message}\n${summary}\n\nSTDOUT:\n${cleanStdout || "(no output)"}\n\nSTDERR:\n${cleanStderr || "(no output)"}`
          }
        ],
        isError: true
      };
    }
  }

  // New Tools that talk to the Plugin
  if (request.params.name === "create_line") {
      const args = request.params.arguments as any;
      const result = await sendAutoCADCommand("create_line", args);
      return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
  }

  if (request.params.name === "get_layers") {
      const result = await sendAutoCADCommand("get_layers");
      return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
  }

  if (request.params.name === "create_layer") {
      const args = request.params.arguments as any;
      const result = await sendAutoCADCommand("create_layer", args);
      return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
  }

  if (request.params.name === "generate_house_plan") {
    return await handleGenerateHousePlan(request.params.arguments as Record<string, unknown>);
  }

  throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
});

// ── generate_house_plan handler ────────────────────────────────
async function handleGenerateHousePlan(args: Record<string, unknown>) {
  const description = String(args.description ?? "");
  const overrides: Record<string, unknown> = {};
  if (typeof args.lot_width  === "number") overrides.lot_width  = args.lot_width;
  if (typeof args.lot_depth  === "number") overrides.lot_depth  = args.lot_depth;
  if (Array.isArray(args.rooms))           overrides.rooms      = args.rooms;
  if (typeof args.style      === "string") overrides.style      = args.style;
  if (typeof args.include_terrace === "boolean") overrides.include_terrace = args.include_terrace;

  // 1. Parse input → HouseSpec
  const spec = resolveHouseSpec(description, overrides as any);

  // 2. Determine output path
  const timestamp = Date.now();
  const outputPath = typeof args.output_path === "string" && args.output_path
    ? args.output_path
    : path.join(OUTPUTS_DIR, `generated_${timestamp}.dwg`);

  // Ensure output dir exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // 3. Generate layout
  const { layout, warnings } = generateLayout(spec, BLOCKS_DIR);

  // 4. Generate AutoLISP code
  const lspCode = generateLSP(layout, outputPath);

  // 5. Write to temp files
  const lspPath = await writeLSPToTemp(lspCode, TEMP_DIR);
  const scrPath = await writeRunScript(lspPath);

  // 6. Choose a blank/template DWG to open as base
  //    Prefer an existing blank DWG; fall back to reuse pruebas.dwg (available in repo)
  const baseDwgCandidates = [
    path.join(process.cwd(), "pruebas.dwg"),
    path.join(process.cwd(), "outputs", "casa_8x10.dwg"),
  ];
  let baseDwg = "";
  for (const candidate of baseDwgCandidates) {
    try { await fs.access(candidate); baseDwg = candidate; break; } catch { /* not found */ }
  }
  if (!baseDwg) {
    throw new McpError(ErrorCode.InternalError, "No base DWG found to open with accoreconsole. Place pruebas.dwg in the project root.");
  }

  const executionLog: string[] = [];
  let dwgGenerated = false;

  // 7a. Try live plugin first (run_lsp_script command)
  try {
    await sendAutoCADCommand("run_lsp_script", { lspPath });
    dwgGenerated = true;
    executionLog.push("Generated via live AutoCAD plugin.");
  } catch (pluginErr: any) {
    executionLog.push(`Plugin unavailable: ${pluginErr?.message ?? pluginErr}. Falling back to accoreconsole.`);

    // 7b. Headless via accoreconsole
    const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${baseDwg}" /s "${scrPath}"`;
    console.error(`[generate_house_plan] Running: ${command}`);
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 120_000,
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024,
      });
      const cleanStdout = cleanAutoCADOutput(decodeAutoCADOutput(stdout));
      const cleanStderr = cleanAutoCADOutput(decodeAutoCADOutput(stderr));
      const summary = summarizeExecution(cleanStdout, cleanStderr, false);
      executionLog.push(`accoreconsole: ${summary}`);
      dwgGenerated = true;
    } catch (execErr: any) {
      const cleanStdout = cleanAutoCADOutput(decodeAutoCADOutput(execErr.stdout));
      const cleanStderr = cleanAutoCADOutput(decodeAutoCADOutput(execErr.stderr));
      executionLog.push(`accoreconsole error: ${execErr.message}`);
      if (cleanStdout) executionLog.push(`stdout: ${cleanStdout}`);
      if (cleanStderr) executionLog.push(`stderr: ${cleanStderr}`);
      // Continue — DWG might still have been written before the error
    }
  }

  // 8. Check if DWG was actually created
  let dwgExists = false;
  try { await fs.access(outputPath); dwgExists = true; } catch { /* not created */ }

  // 9. Post-process: run semantic pipeline if DWG exists
  let semanticSummary = "";
  if (dwgExists) {
    try {
      const extractLsp = path.join(SCRIPTS_DIR, "extract_context.lsp");
      const extractScr = path.join(TEMP_DIR, `extract_${timestamp}.scr`);
      const contextOut  = path.join(OUTPUTS_DIR, "plano-contexto.json");
      const extractLspExists = await fs.access(extractLsp).then(() => true).catch(() => false);

      if (extractLspExists) {
        // Build a scr that opens the generated DWG and runs extract_context
        const extractContent = `(load "${lspPath.replace(/\\/g, "/")}")(load "${extractLsp.replace(/\\/g, "/")}")\n`;
        await fs.writeFile(extractScr, extractContent, "utf-8");
        await execAsync(`"${AUTOCAD_CONSOLE_PATH}" /i "${outputPath}" /s "${extractScr}"`, {
          timeout: 90_000, encoding: "buffer", maxBuffer: 10 * 1024 * 1024,
        }).catch(e => console.error("[generate_house_plan] extract_context failed:", e.message));
      }

      // Run Python semantic pipeline
      const semanticScriptExists = await fs.access(SEMANTIC_SCRIPT).then(() => true).catch(() => false);
      const contextExists = await fs.access(contextOut).then(() => true).catch(() => false);

      if (semanticScriptExists && contextExists) {
        await new Promise<void>((resolve) => {
          const py = spawn("python", [SEMANTIC_SCRIPT], { cwd: process.cwd() });
          py.on("close", () => resolve());
          py.on("error", () => resolve());
        });
        const summaryPath = path.join(OUTPUTS_DIR, "plano-resumen.md");
        const summaryExists = await fs.access(summaryPath).then(() => true).catch(() => false);
        if (summaryExists) {
          semanticSummary = await fs.readFile(summaryPath, "utf-8");
        }
      }
    } catch (semanticErr: any) {
      console.error("[generate_house_plan] Semantic pipeline error:", semanticErr.message);
      executionLog.push(`Semantic pipeline error: ${semanticErr.message}`);
    }
  }

  // 10. Compose response
  const roomSummary = layout.rooms
    .map(r => `  • ${r.label}: ${r.area.toFixed(1)}m² (${r.x1.toFixed(2)},${r.y1.toFixed(2)}) → (${r.x2.toFixed(2)},${r.y2.toFixed(2)})`)
    .join("\n");

  const response = [
    `## House Plan Generated`,
    ``,
    `**Lot:** ${spec.lot_width}m × ${spec.lot_depth}m`,
    `**Rooms:** ${layout.rooms.length} (${layout.doors.length} doors, ${layout.windows.length} windows)`,
    `**Output DWG:** ${outputPath}`,
    `**Status:** ${dwgExists ? "✅ DWG created" : "⚠️ DWG not confirmed (check accoreconsole output)"}`,
    ``,
    `### Room Layout`,
    roomSummary,
    warnings.length > 0 ? `\n### ⚠️ Layout Warnings\n${warnings.map(w => `  - ${w}`).join("\n")}` : "",
    ``,
    `### Execution Log`,
    executionLog.map(l => `  ${l}`).join("\n"),
    semanticSummary ? `\n### Semantic Analysis\n${semanticSummary}` : "",
    ``,
    `### Generated LSP`,
    `\`${lspPath}\``,
  ].filter(l => l !== "").join("\n");

  return { content: [{ type: "text", text: response }] };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AutoCAD MCP Server running on stdio");
  console.error(`Configured Console Path: ${AUTOCAD_CONSOLE_PATH}`);
  console.error(`Configured Scripts Dir: ${SCRIPTS_DIR}`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
