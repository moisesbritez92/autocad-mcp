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
import { validateDrawing, validateLayoutQuick, extractValidation, runSemanticPipeline } from "./validationPipeline.js";

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
      // ── Existing Core Tools ─────────────────────────────────────────
      {
        name: "execute_script_file",
        description: "Executes an AutoCAD script (.scr) against a drawing (.dwg) using accoreconsole (headless). Best for batch processing.",
        inputSchema: {
          type: "object",
          properties: {
            drawingPath: { type: "string", description: "Full path to the .dwg file to process" },
            scriptPath: { type: "string", description: "Full path to the .scr script to run" },
            timeout: { type: "number", description: "Timeout in seconds (default: 60)" }
          },
          required: ["drawingPath", "scriptPath"]
        }
      },
      {
        name: "list_available_scripts",
        description: "Lists all available .scr and .lsp files in the configured scripts directory.",
        inputSchema: { type: "object", properties: {} }
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
            endY: { type: "number", description: "End Y coordinate" },
            layer: { type: "string", description: "Target layer name (optional)" }
          },
          required: ["startX", "startY", "endX", "endY"]
        }
      },
      {
        name: "get_layers",
        description: "Gets all layers with their properties (color, state, lineweight) in the active document.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "create_layer",
        description: "Creates a new layer in the active AutoCAD document.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new layer" },
            color: { type: "number", description: "ACI color index (default: 7 white)" },
            lineWeight: { type: "string", description: "Line weight e.g. 'LineWeight025' (optional)" }
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
            blockPath: { type: "string", description: "Full path to DWG file if block is not loaded." },
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
            command: { type: "string", description: "AutoCAD command or LISP expression" }
          },
          required: ["command"]
        }
      },
      {
        name: "generate_house_plan",
        description: "Generates a complete 2D architectural floor plan from natural language or structured JSON. Applies zones, proportions, lighting rules. Produces wall shells via REGION/SUBTRACT, inserts door/window blocks, labels rooms, saves DWG.",
        inputSchema: {
          type: "object",
          properties: {
            description: { type: "string", description: "Natural language description OR JSON string with HouseSpec fields." },
            lot_width:  { type: "number", description: "Lot width in metres" },
            lot_depth:  { type: "number", description: "Lot depth in metres" },
            rooms: {
              type: "array",
              description: "Explicit room list",
              items: {
                type: "object",
                properties: {
                  type:  { type: "string" },
                  count: { type: "number" },
                  label: { type: "string" }
                },
                required: ["type", "count"]
              }
            },
            style: { type: "string", enum: ["compact", "linear", "open"] },
            include_terrace: { type: "boolean" },
            output_path: { type: "string", description: "Full path to output .dwg file" }
          },
          required: ["description"]
        }
      },

      // ── Geometry Advanced ───────────────────────────────────────────
      {
        name: "create_circle",
        description: "Creates a circle in the active drawing.",
        inputSchema: {
          type: "object",
          properties: {
            centerX: { type: "number", description: "Center X" },
            centerY: { type: "number", description: "Center Y" },
            radius: { type: "number", description: "Radius" },
            layer: { type: "string", description: "Target layer (optional)" }
          },
          required: ["centerX", "centerY", "radius"]
        }
      },
      {
        name: "create_arc",
        description: "Creates an arc by center, radius, start and end angles (degrees).",
        inputSchema: {
          type: "object",
          properties: {
            centerX: { type: "number" }, centerY: { type: "number" },
            radius: { type: "number" },
            startAngle: { type: "number", description: "Start angle in degrees" },
            endAngle: { type: "number", description: "End angle in degrees" },
            layer: { type: "string" }
          },
          required: ["centerX", "centerY", "radius", "startAngle", "endAngle"]
        }
      },
      {
        name: "create_polyline",
        description: "Creates a polyline (open or closed) from an array of points with optional bulge values for arcs.",
        inputSchema: {
          type: "object",
          properties: {
            points: {
              type: "array",
              description: "Array of {x, y, bulge?} objects. bulge=0 for straight, bulge=1 for semicircle",
              items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, bulge: { type: "number" } }, required: ["x", "y"] }
            },
            closed: { type: "boolean", description: "Close the polyline (default false)" },
            layer: { type: "string" }
          },
          required: ["points"]
        }
      },
      {
        name: "create_rectangle",
        description: "Creates a closed rectangular polyline from two corner points.",
        inputSchema: {
          type: "object",
          properties: {
            x1: { type: "number" }, y1: { type: "number" },
            x2: { type: "number" }, y2: { type: "number" },
            layer: { type: "string" }
          },
          required: ["x1", "y1", "x2", "y2"]
        }
      },
      {
        name: "create_ellipse",
        description: "Creates an ellipse by center, major/minor radii, and rotation.",
        inputSchema: {
          type: "object",
          properties: {
            centerX: { type: "number" }, centerY: { type: "number" },
            majorRadius: { type: "number" }, minorRadius: { type: "number" },
            rotation: { type: "number", description: "Major axis rotation in degrees (default 0)" },
            layer: { type: "string" }
          },
          required: ["centerX", "centerY", "majorRadius", "minorRadius"]
        }
      },
      {
        name: "create_spline",
        description: "Creates a spline curve through fit points.",
        inputSchema: {
          type: "object",
          properties: {
            points: {
              type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }
            },
            closed: { type: "boolean" },
            layer: { type: "string" }
          },
          required: ["points"]
        }
      },
      {
        name: "create_hatch",
        description: "Creates a hatch fill inside boundary entities.",
        inputSchema: {
          type: "object",
          properties: {
            boundaryHandles: { type: "array", items: { type: "string" }, description: "Hex handles of boundary curves" },
            pattern: { type: "string", description: "Pattern name: SOLID, ANSI31, ANSI37, etc. (default SOLID)" },
            scale: { type: "number", description: "Pattern scale (default 1.0)" },
            angle: { type: "number", description: "Pattern angle in degrees" },
            layer: { type: "string" }
          },
          required: ["boundaryHandles"]
        }
      },

      // ── Query & Measurement ─────────────────────────────────────────
      {
        name: "query_entities",
        description: "Searches for entities by type and/or layer. Returns handles and basic properties.",
        inputSchema: {
          type: "object",
          properties: {
            entityType: { type: "string", description: "Filter by type: Line, Circle, Arc, Polyline, BlockReference, DBText, MText, Hatch, etc." },
            layer: { type: "string", description: "Filter by layer name" },
            limit: { type: "number", description: "Max results (default 100)" }
          }
        }
      },
      {
        name: "get_entity_properties",
        description: "Gets detailed properties of an entity by its hex handle.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the entity" }
          },
          required: ["handle"]
        }
      },
      {
        name: "measure_distance",
        description: "Measures the distance between two points.",
        inputSchema: {
          type: "object",
          properties: {
            x1: { type: "number" }, y1: { type: "number" },
            x2: { type: "number" }, y2: { type: "number" }
          },
          required: ["x1", "y1", "x2", "y2"]
        }
      },
      {
        name: "measure_area",
        description: "Measures the area and perimeter of a closed entity (Polyline, Circle, Region, Hatch).",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the entity" }
          },
          required: ["handle"]
        }
      },
      {
        name: "count_entities",
        description: "Counts entities in the drawing, optionally filtered by type and/or layer. Returns total and breakdown by type.",
        inputSchema: {
          type: "object",
          properties: {
            entityType: { type: "string", description: "Filter by entity type" },
            layer: { type: "string", description: "Filter by layer" }
          }
        }
      },
      {
        name: "get_drawing_extents",
        description: "Returns the bounding box of all entities in the drawing (min/max coordinates and dimensions).",
        inputSchema: { type: "object", properties: {} }
      },

      // ── Modify / Transform ──────────────────────────────────────────
      {
        name: "move_entities",
        description: "Moves entities by a displacement vector (deltaX, deltaY).",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" }, description: "Hex handles of entities to move" },
            deltaX: { type: "number" }, deltaY: { type: "number" }
          },
          required: ["handles", "deltaX", "deltaY"]
        }
      },
      {
        name: "rotate_entities",
        description: "Rotates entities around a base point by an angle in degrees.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            baseX: { type: "number" }, baseY: { type: "number" },
            angle: { type: "number", description: "Rotation angle in degrees" }
          },
          required: ["handles", "baseX", "baseY", "angle"]
        }
      },
      {
        name: "scale_entities",
        description: "Scales entities from a base point by a scale factor.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            baseX: { type: "number" }, baseY: { type: "number" },
            factor: { type: "number", description: "Scale factor (e.g. 2.0 = double size)" }
          },
          required: ["handles", "baseX", "baseY", "factor"]
        }
      },
      {
        name: "copy_entities",
        description: "Duplicates entities with an offset displacement. Returns handles of new copies.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            deltaX: { type: "number" }, deltaY: { type: "number" }
          },
          required: ["handles", "deltaX", "deltaY"]
        }
      },
      {
        name: "mirror_entities",
        description: "Mirrors entities across an axis line. Optionally erases the source.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            axisX1: { type: "number" }, axisY1: { type: "number" },
            axisX2: { type: "number" }, axisY2: { type: "number" },
            eraseSource: { type: "boolean", description: "Delete original entities (default false)" }
          },
          required: ["handles", "axisX1", "axisY1", "axisX2", "axisY2"]
        }
      },
      {
        name: "offset_entity",
        description: "Creates an offset copy of a curve (line, polyline, circle, arc, spline) at a given distance.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the curve" },
            distance: { type: "number", description: "Offset distance (positive = one side, negative = other side)" }
          },
          required: ["handle", "distance"]
        }
      },
      {
        name: "erase_entities",
        description: "Deletes entities from the drawing by their handles.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" }, description: "Hex handles of entities to erase" }
          },
          required: ["handles"]
        }
      },
      {
        name: "change_layer",
        description: "Moves entities to a different layer.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            layer: { type: "string", description: "Target layer name" }
          },
          required: ["handles", "layer"]
        }
      },
      {
        name: "change_color",
        description: "Changes the color of entities by ACI color index.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" } },
            color: { type: "number", description: "ACI color index (1=red, 2=yellow, 3=green, 4=cyan, 5=blue, 6=magenta, 7=white)" }
          },
          required: ["handles", "color"]
        }
      },

      // ── Block Management ────────────────────────────────────────────
      {
        name: "list_blocks",
        description: "Lists all block definitions in the current drawing with reference counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "list_available_blocks",
        description: "Lists available block files from the blocks library directory.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "explode_block",
        description: "Explodes a block reference into its component entities. Returns handles of new entities.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the block reference to explode" }
          },
          required: ["handle"]
        }
      },
      {
        name: "get_block_attributes",
        description: "Gets all attribute tag/value pairs from a block reference.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the block reference" }
          },
          required: ["handle"]
        }
      },
      {
        name: "set_block_attribute",
        description: "Sets the value of an attribute in a block reference by tag name.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the block reference" },
            tag: { type: "string", description: "Attribute tag name" },
            value: { type: "string", description: "New value for the attribute" }
          },
          required: ["handle", "tag", "value"]
        }
      },

      // ── Dimensions ──────────────────────────────────────────────────
      {
        name: "add_linear_dimension",
        description: "Adds a linear (horizontal/vertical/auto) dimension between two points.",
        inputSchema: {
          type: "object",
          properties: {
            x1: { type: "number" }, y1: { type: "number" },
            x2: { type: "number" }, y2: { type: "number" },
            offset: { type: "number", description: "Distance from measured line to dim line (default 1.0)" },
            orientation: { type: "string", enum: ["H", "V", "auto"], description: "Horizontal, Vertical, or auto-detect" },
            layer: { type: "string" }
          },
          required: ["x1", "y1", "x2", "y2"]
        }
      },
      {
        name: "add_aligned_dimension",
        description: "Adds an aligned dimension between two points (follows the angle of the line).",
        inputSchema: {
          type: "object",
          properties: {
            x1: { type: "number" }, y1: { type: "number" },
            x2: { type: "number" }, y2: { type: "number" },
            offset: { type: "number", description: "Perpendicular offset for dim line" },
            layer: { type: "string" }
          },
          required: ["x1", "y1", "x2", "y2"]
        }
      },
      {
        name: "add_radial_dimension",
        description: "Adds a radius dimension to a circle or arc entity.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of Circle or Arc entity" },
            leaderLength: { type: "number", description: "Length of the leader line (default 2.0)" },
            layer: { type: "string" }
          },
          required: ["handle"]
        }
      },

      // ── Text & Annotations ──────────────────────────────────────────
      {
        name: "create_mtext",
        description: "Creates multiline text (MText) with formatting support.",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            text: { type: "string", description: "Text content (supports \\P for newlines)" },
            height: { type: "number", description: "Text height (default 0.25)" },
            width: { type: "number", description: "Boundary width (default 10)" },
            rotation: { type: "number", description: "Rotation in degrees" },
            layer: { type: "string" }
          },
          required: ["x", "y", "text"]
        }
      },
      {
        name: "create_text",
        description: "Creates single-line text (DBText).",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            text: { type: "string" },
            height: { type: "number", description: "Text height (default 0.25)" },
            rotation: { type: "number", description: "Rotation in degrees" },
            layer: { type: "string" }
          },
          required: ["x", "y", "text"]
        }
      },
      {
        name: "create_leader",
        description: "Creates a leader (arrow annotation) with optional text.",
        inputSchema: {
          type: "object",
          properties: {
            points: {
              type: "array",
              items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
              description: "Leader vertices from arrow tip to text point (min 2)"
            },
            text: { type: "string", description: "Annotation text at the end of the leader" },
            layer: { type: "string" }
          },
          required: ["points"]
        }
      },
      {
        name: "create_table",
        description: "Creates a table with specified rows, columns, and data.",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" },
            rows: { type: "number" }, columns: { type: "number" },
            rowHeight: { type: "number", description: "Row height (default 0.8)" },
            columnWidth: { type: "number", description: "Column width (default 3.0)" },
            data: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of cell values" },
            layer: { type: "string" }
          },
          required: ["x", "y", "rows", "columns"]
        }
      },
      {
        name: "update_text",
        description: "Updates the content of a text entity (DBText or MText).",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the text entity" },
            text: { type: "string", description: "New text content" }
          },
          required: ["handle", "text"]
        }
      },

      // ── Layer Management ────────────────────────────────────────────
      {
        name: "set_layer_properties",
        description: "Modifies properties of an existing layer (color, on/off, freeze, lock, lineweight).",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Layer name" },
            color: { type: "number", description: "ACI color index" },
            isOff: { type: "boolean" },
            isFrozen: { type: "boolean" },
            isLocked: { type: "boolean" },
            lineWeight: { type: "string" }
          },
          required: ["name"]
        }
      },
      {
        name: "delete_layer",
        description: "Deletes a layer from the drawing (cannot delete layer '0' or 'Defpoints').",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Layer name to delete" }
          },
          required: ["name"]
        }
      },
      {
        name: "set_current_layer",
        description: "Sets the current/active layer for new entities.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Layer name to set as current" }
          },
          required: ["name"]
        }
      },

      // ── Document Operations ─────────────────────────────────────────
      {
        name: "save_drawing",
        description: "Saves the current drawing. Optionally saves to a new path (Save As).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Optional path for Save As (omit for Save)" }
          }
        }
      },
      {
        name: "zoom_extents",
        description: "Zoom to show all entities in the drawing.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "undo",
        description: "Undo the last N operations.",
        inputSchema: {
          type: "object",
          properties: {
            count: { type: "number", description: "Number of operations to undo (default 1)" }
          }
        }
      },

      // ── Export (headless via accoreconsole) ──────────────────────────
      {
        name: "export_to_pdf",
        description: "Exports a DWG to PDF using accoreconsole (headless). Uses the DWG-to-PDF.pc3 plotter.",
        inputSchema: {
          type: "object",
          properties: {
            drawingPath: { type: "string", description: "Path to source .dwg file" },
            outputPath: { type: "string", description: "Path for output .pdf file" },
            paperSize: { type: "string", description: "Paper size e.g. 'ISO_A4_(210.00_x_297.00_MM)' (default auto)" }
          },
          required: ["drawingPath", "outputPath"]
        }
      },
      {
        name: "export_to_dxf",
        description: "Converts a DWG to DXF format using accoreconsole.",
        inputSchema: {
          type: "object",
          properties: {
            drawingPath: { type: "string", description: "Path to source .dwg file" },
            outputPath: { type: "string", description: "Path for output .dxf file" },
            version: { type: "string", enum: ["R12", "2000", "2004", "2007", "2010", "2013", "2018"], description: "DXF version (default 2018)" }
          },
          required: ["drawingPath", "outputPath"]
        }
      },

      // ── Geometry Advanced (Phase 2) ─────────────────────────────────
      {
        name: "create_region",
        description: "Creates a region from closed boundary entities (polylines, circles). Returns the region handle.",
        inputSchema: {
          type: "object",
          properties: {
            handles: { type: "array", items: { type: "string" }, description: "Hex handles of closed boundary curves" },
            layer: { type: "string" }
          },
          required: ["handles"]
        }
      },
      {
        name: "trim_entity",
        description: "Trims an entity at cutting edges defined by other entities.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the entity to trim" },
            cuttingHandles: { type: "array", items: { type: "string" }, description: "Hex handles of cutting boundary entities" },
            pickPointX: { type: "number", description: "X of the pick point (side to keep)" },
            pickPointY: { type: "number", description: "Y of the pick point (side to keep)" }
          },
          required: ["handle", "cuttingHandles", "pickPointX", "pickPointY"]
        }
      },
      {
        name: "extend_entity",
        description: "Extends an entity to meet boundary entities.",
        inputSchema: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Hex handle of the entity to extend" },
            boundaryHandles: { type: "array", items: { type: "string" }, description: "Hex handles of boundary entities to extend to" },
            pickPointX: { type: "number", description: "X near the end to extend" },
            pickPointY: { type: "number", description: "Y near the end to extend" }
          },
          required: ["handle", "boundaryHandles", "pickPointX", "pickPointY"]
        }
      },

      // ── Dimensions (Phase 2) ────────────────────────────────────────
      {
        name: "add_angular_dimension",
        description: "Adds an angular dimension between two lines, measured at a center point.",
        inputSchema: {
          type: "object",
          properties: {
            centerX: { type: "number" }, centerY: { type: "number" },
            pt1X: { type: "number" }, pt1Y: { type: "number" },
            pt2X: { type: "number" }, pt2Y: { type: "number" },
            arcX: { type: "number", description: "Arc point X (where the dimension arc appears)" },
            arcY: { type: "number", description: "Arc point Y" },
            layer: { type: "string" }
          },
          required: ["centerX", "centerY", "pt1X", "pt1Y", "pt2X", "pt2Y", "arcX", "arcY"]
        }
      },
      {
        name: "auto_dimension_room",
        description: "Automatically adds 4 aligned dimensions around a rectangular room bounding box.",
        inputSchema: {
          type: "object",
          properties: {
            minX: { type: "number" }, minY: { type: "number" },
            maxX: { type: "number" }, maxY: { type: "number" },
            offset: { type: "number", description: "Offset for dim lines from walls (default 1.0)" },
            layer: { type: "string" }
          },
          required: ["minX", "minY", "maxX", "maxY"]
        }
      },

      // ── Block Management (Phase 2) ──────────────────────────────────
      {
        name: "create_block_definition",
        description: "Creates a new block definition from existing entities in the drawing.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Block definition name" },
            baseX: { type: "number", description: "Base point X" },
            baseY: { type: "number", description: "Base point Y" },
            entityHandles: { type: "array", items: { type: "string" }, description: "Hex handles of entities to include" }
          },
          required: ["name", "baseX", "baseY", "entityHandles"]
        }
      },

      // ── Maintenance ─────────────────────────────────────────────────
      {
        name: "purge_drawing",
        description: "Purges unused blocks, layers, linetypes, text styles, and dim styles from the drawing. Multiple passes for thorough cleanup.",
        inputSchema: {
          type: "object",
          properties: {
            passes: { type: "number", description: "Number of purge passes (default 3)" }
          }
        }
      },

      // ── Export Image (headless) ─────────────────────────────────────
      {
        name: "export_to_image",
        description: "Exports a DWG to PNG or BMP image using accoreconsole (headless).",
        inputSchema: {
          type: "object",
          properties: {
            drawingPath: { type: "string", description: "Path to source .dwg file" },
            outputPath: { type: "string", description: "Path for output image file (.png or .bmp)" },
            width: { type: "number", description: "Image width in pixels (default 2048)" },
            height: { type: "number", description: "Image height in pixels (default 1536)" }
          },
          required: ["drawingPath", "outputPath"]
        }
      },
      {
        name: "batch_export",
        description: "Batch exports multiple DWG files to PDF, DXF, or image format using accoreconsole.",
        inputSchema: {
          type: "object",
          properties: {
            drawings: {
              type: "array",
              items: { type: "object", properties: { drawingPath: { type: "string" }, outputPath: { type: "string" } }, required: ["drawingPath", "outputPath"] },
              description: "Array of {drawingPath, outputPath} pairs"
            },
            format: { type: "string", enum: ["pdf", "dxf", "png"], description: "Output format (default pdf)" }
          },
          required: ["drawings"]
        }
      },

      // ── Validation & Analysis ───────────────────────────────────────
      {
        name: "validate_drawing",
        description: "Runs the full semantic validation pipeline on a drawing context JSON. Returns rooms, openings, validation checks, and design quality scores.",
        inputSchema: {
          type: "object",
          properties: {
            contextJsonPath: { type: "string", description: "Path to the context JSON file (from extract_context.lsp)" }
          },
          required: ["contextJsonPath"]
        }
      },
      {
        name: "validate_layout_quick",
        description: "Quick validation of a layout (rooms, doors, windows) against architecture rules without needing a DWG. Checks min areas, aspect ratios, coverage, door/window counts.",
        inputSchema: {
          type: "object",
          properties: {
            rooms: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" }, type: { type: "string" },
                  x1: { type: "number" }, y1: { type: "number" },
                  x2: { type: "number" }, y2: { type: "number" }
                },
                required: ["label", "type", "x1", "y1", "x2", "y2"]
              }
            },
            doors: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" } }, required: ["x", "y", "width"] } },
            windows: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" } }, required: ["x", "y", "width"] } },
            lot_width: { type: "number" },
            lot_depth: { type: "number" }
          },
          required: ["rooms", "doors", "windows", "lot_width", "lot_depth"]
        }
      },
      {
        name: "compute_metrics",
        description: "Computes drawing metrics from a context JSON: room count, area totals, glazing ratio, circulation ratio, etc.",
        inputSchema: {
          type: "object",
          properties: {
            contextJsonPath: { type: "string", description: "Path to the context JSON file" }
          },
          required: ["contextJsonPath"]
        }
      }
    ]
  };
});

// Handler for executing tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, any>;

  // ── Helper: forward a command to the AutoCAD Plugin ──────────
  const pluginForward = async (command: string, cmdArgs?: Record<string, any>) => {
    const result = await sendAutoCADCommand(command, cmdArgs);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  };

  // ── Batch processing / headless tools ────────────────────────
  if (name === "list_available_scripts") {
    const scripts = await listScripts(SCRIPTS_DIR);
    return {
      content: [{
        type: "text",
        text: `Available Scripts in ${SCRIPTS_DIR}:\n${scripts.join("\n") || "No scripts found."}`
      }]
    };
  }

  if (name === "execute_script_file") {
    const drawingPath = String(args.drawingPath);
    const scriptPath = String(args.scriptPath);
    const timeoutSec = Number(args.timeout) || 60;

    if (!drawingPath || !scriptPath) {
      throw new McpError(ErrorCode.InvalidParams, "drawingPath and scriptPath are required");
    }

    try {
      await fs.access(drawingPath);
      await fs.access(scriptPath);
    } catch {
      throw new McpError(ErrorCode.InvalidParams, `File not found: ${drawingPath} or ${scriptPath}`);
    }

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
      return { content: [{ type: "text", text: `Execution Completed.\n${summary}\n\nSTDOUT:\n${cleanStdout || "(no output)"}\n\nSTDERR:\n${cleanStderr || "(no output)"}` }] };
    } catch (error: any) {
      const cleanStdout = cleanAutoCADOutput(decodeAutoCADOutput(error.stdout));
      const cleanStderr = cleanAutoCADOutput(decodeAutoCADOutput(error.stderr));
      const summary = summarizeExecution(cleanStdout, cleanStderr, true);
      return { content: [{ type: "text", text: `Error executing script: ${error.message}\n${summary}\n\nSTDOUT:\n${cleanStdout || "(no output)"}\n\nSTDERR:\n${cleanStderr || "(no output)"}` }], isError: true };
    }
  }

  // ── House plan generator ─────────────────────────────────────
  if (name === "generate_house_plan") {
    return await handleGenerateHousePlan(args);
  }

  // ── List available blocks from library ───────────────────────
  if (name === "list_available_blocks") {
    try {
      const indexPath = path.join(BLOCKS_DIR, "index.json");
      const data = await fs.readFile(indexPath, "utf-8");
      return { content: [{ type: "text", text: data }] };
    } catch {
      return { content: [{ type: "text", text: "No block index found." }] };
    }
  }

  // ── Export tools (headless via accoreconsole) ────────────────
  if (name === "export_to_pdf") {
    const drawingPath = String(args.drawingPath);
    const outputPath = String(args.outputPath);
    const paperSize = args.paperSize || "ISO_A4_(210.00_x_297.00_MM)";

    try { await fs.access(drawingPath); } catch {
      throw new McpError(ErrorCode.InvalidParams, `Drawing not found: ${drawingPath}`);
    }

    // Create a temporary script that plots to PDF
    const scrContent = [
      `._-PLOT`,
      `Y`,              // Detailed plot config? Yes
      `Model`,          // Layout name
      `DWG To PDF.pc3`, // Plotter
      paperSize,
      `Millimeters`,    // Paper units
      `Landscape`,      // Orientation
      `N`,              // Plot upside down? No
      `E`,              // Plot area: Extents
      `F`,              // Fit to paper
      `C`,              // Center: Center
      `Y`,              // Plot with plot styles? Yes
      `acad.ctb`,       // Plot style table
      `Y`,              // Plot with lineweights? Yes
      `N`,              // Scale lineweights? No
      `N`,              // Plot stamp? No
      `Y`,              // Save changes? Yes
      `"${outputPath.replace(/\\/g, "/")}"`,
      `Y`,              // Proceed? Yes
      ``
    ].join("\n");

    const scrPath = path.join(TEMP_DIR, `pdf_export_${Date.now()}.scr`);
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.writeFile(scrPath, scrContent, "utf-8");

    const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${drawingPath}" /s "${scrPath}"`;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 120_000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
      const out = cleanAutoCADOutput(decodeAutoCADOutput(stdout));
      const err = cleanAutoCADOutput(decodeAutoCADOutput(stderr));
      return { content: [{ type: "text", text: `PDF Export complete.\nOutput: ${outputPath}\n\n${out}\n${err}` }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `PDF Export failed: ${error.message}` }], isError: true };
    }
  }

  if (name === "export_to_dxf") {
    const drawingPath = String(args.drawingPath);
    const outputPath = String(args.outputPath);
    const version = args.version || "2018";

    try { await fs.access(drawingPath); } catch {
      throw new McpError(ErrorCode.InvalidParams, `Drawing not found: ${drawingPath}`);
    }

    const versionMap: Record<string, string> = {
      "R12": "12", "2000": "2000", "2004": "2004", "2007": "2007",
      "2010": "2010", "2013": "2013", "2018": "2018"
    };
    const dxfVer = versionMap[version] || "2018";

    const scrContent = `._DXFOUT\n"${outputPath.replace(/\\/g, "/")}"\nV\nR${dxfVer}\n16\n\n`;
    const scrPath = path.join(TEMP_DIR, `dxf_export_${Date.now()}.scr`);
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.writeFile(scrPath, scrContent, "utf-8");

    const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${drawingPath}" /s "${scrPath}"`;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 120_000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
      const out = cleanAutoCADOutput(decodeAutoCADOutput(stdout));
      const err = cleanAutoCADOutput(decodeAutoCADOutput(stderr));
      return { content: [{ type: "text", text: `DXF Export complete.\nOutput: ${outputPath}\n\n${out}\n${err}` }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `DXF Export failed: ${error.message}` }], isError: true };
    }
  }

  // ── Export to image (headless via accoreconsole) ──────────────
  if (name === "export_to_image") {
    const drawingPath = String(args.drawingPath);
    const outputPath = String(args.outputPath);
    const width = Number(args.width) || 2048;
    const height = Number(args.height) || 1536;

    try { await fs.access(drawingPath); } catch {
      throw new McpError(ErrorCode.InvalidParams, `Drawing not found: ${drawingPath}`);
    }

    const ext = path.extname(outputPath).toLowerCase();
    const exportCmd = ext === ".bmp" ? "BMPOUT" : "PNGOUT";

    const scrContent = [
      `._ZOOM E`,
      `(setvar "BACKGROUNDPLOT" 0)`,
      `._${exportCmd}`,
      `"${outputPath.replace(/\\/g, "/")}"`,
      ``
    ].join("\n");

    const scrPath = path.join(TEMP_DIR, `img_export_${Date.now()}.scr`);
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.writeFile(scrPath, scrContent, "utf-8");

    const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${drawingPath}" /s "${scrPath}"`;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 120_000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
      const out = cleanAutoCADOutput(decodeAutoCADOutput(stdout));
      const err = cleanAutoCADOutput(decodeAutoCADOutput(stderr));
      return { content: [{ type: "text", text: `Image Export complete.\nOutput: ${outputPath}\n\n${out}\n${err}` }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Image Export failed: ${error.message}` }], isError: true };
    }
  }

  // ── Batch export ─────────────────────────────────────────────
  if (name === "batch_export") {
    const drawings = args.drawings as Array<{ drawingPath: string; outputPath: string }>;
    const format = String(args.format || "pdf");

    if (!drawings || drawings.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "drawings array is required and must not be empty");
    }

    const results: string[] = [];
    for (const item of drawings) {
      try {
        let scrContent: string;
        if (format === "dxf") {
          scrContent = `._DXFOUT\n"${item.outputPath.replace(/\\/g, "/")}"\nV\nR2018\n16\n\n`;
        } else if (format === "png") {
          scrContent = `._ZOOM E\n._PNGOUT\n"${item.outputPath.replace(/\\/g, "/")}"\n\n`;
        } else {
          // PDF
          scrContent = [
            `._-PLOT`, `Y`, `Model`, `DWG To PDF.pc3`,
            `ISO_A4_(210.00_x_297.00_MM)`, `Millimeters`, `Landscape`,
            `N`, `E`, `F`, `C`, `Y`, `acad.ctb`, `Y`, `N`, `N`, `Y`,
            `"${item.outputPath.replace(/\\/g, "/")}"`, `Y`, ``
          ].join("\n");
        }

        const scrPath = path.join(TEMP_DIR, `batch_${Date.now()}_${path.basename(item.drawingPath, ".dwg")}.scr`);
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await fs.writeFile(scrPath, scrContent, "utf-8");

        const command = `"${AUTOCAD_CONSOLE_PATH}" /i "${item.drawingPath}" /s "${scrPath}"`;
        await execAsync(command, { timeout: 120_000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
        results.push(`✅ ${path.basename(item.drawingPath)} → ${path.basename(item.outputPath)}`);
      } catch (error: any) {
        results.push(`❌ ${path.basename(item.drawingPath)}: ${error.message}`);
      }
    }

    return { content: [{ type: "text", text: `Batch Export (${format.toUpperCase()}):\n${results.join("\n")}` }] };
  }

  // ── Validation tools ─────────────────────────────────────────
  if (name === "validate_drawing") {
    const contextJsonPath = String(args.contextJsonPath);
    try {
      const result = await validateDrawing(contextJsonPath, process.cwd());
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Validation failed: ${error.message}` }], isError: true };
    }
  }

  if (name === "validate_layout_quick") {
    const layoutData = {
      rooms: args.rooms as Array<{ label: string; type: string; x1: number; y1: number; x2: number; y2: number }>,
      doors: args.doors as Array<{ x: number; y: number; width: number }>,
      windows: args.windows as Array<{ x: number; y: number; width: number }>,
      lot_width: Number(args.lot_width),
      lot_depth: Number(args.lot_depth),
    };
    const result = validateLayoutQuick(layoutData);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "compute_metrics") {
    const contextJsonPath = String(args.contextJsonPath);
    try {
      const enriched = await runSemanticPipeline(contextJsonPath, process.cwd());
      const result = extractValidation(enriched);
      return { content: [{ type: "text", text: JSON.stringify(result.metrics, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Compute metrics failed: ${error.message}` }], isError: true };
    }
  }

  // ── Plugin-forwarded tools (direct pass-through) ─────────────
  // Map MCP tool names → Plugin command names
  const pluginCommandMap: Record<string, string> = {
    // Original tools
    create_line: "create_line",
    get_layers: "get_layers",
    create_layer: "create_layer",
    insert_block: "insert_block",
    run_command: "run_command",

    // Geometry
    create_circle: "CreateCircle",
    create_arc: "CreateArc",
    create_polyline: "CreatePolyline",
    create_rectangle: "CreateRectangle",
    create_ellipse: "CreateEllipse",
    create_spline: "CreateSpline",
    create_hatch: "CreateHatch",

    // Query & Measurement
    query_entities: "QueryEntities",
    get_entity_properties: "GetEntityProperties",
    measure_distance: "MeasureDistance",
    measure_area: "MeasureArea",
    count_entities: "CountEntities",
    get_drawing_extents: "GetDrawingExtents",

    // Modify / Transform
    move_entities: "MoveEntities",
    rotate_entities: "RotateEntities",
    scale_entities: "ScaleEntities",
    copy_entities: "CopyEntities",
    mirror_entities: "MirrorEntities",
    offset_entity: "OffsetEntity",
    erase_entities: "EraseEntities",
    change_layer: "ChangeLayer",
    change_color: "ChangeColor",

    // Blocks
    list_blocks: "ListBlocks",
    explode_block: "ExplodeBlock",
    get_block_attributes: "GetBlockAttributes",
    set_block_attribute: "SetBlockAttribute",

    // Dimensions
    add_linear_dimension: "AddLinearDimension",
    add_aligned_dimension: "AddAlignedDimension",
    add_radial_dimension: "AddRadialDimension",

    // Text & Annotations
    create_mtext: "CreateMText",
    create_text: "CreateText",
    create_leader: "CreateLeader",
    create_table: "CreateTable",
    update_text: "UpdateText",

    // Layer management
    set_layer_properties: "SetLayerProperties",
    delete_layer: "DeleteLayer",
    set_current_layer: "SetCurrentLayer",

    // Document operations
    save_drawing: "SaveDrawing",
    zoom_extents: "ZoomExtents",
    undo: "Undo",

    // Phase 2: Geometry Advanced
    create_region: "CreateRegion",
    trim_entity: "TrimEntity",
    extend_entity: "ExtendEntity",

    // Phase 2: Dimensions
    add_angular_dimension: "AddAngularDimension",
    auto_dimension_room: "AutoDimensionRoom",

    // Phase 2: Blocks
    create_block_definition: "CreateBlockDefinition",

    // Phase 2: Maintenance
    purge_drawing: "PurgeDrawing",
  };

  const pluginCommand = pluginCommandMap[name];
  if (pluginCommand) {
    return pluginForward(pluginCommand, args);
  }

  throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
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
