import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";
import { Buffer } from "buffer";
import { sendAutoCADCommand } from "./autocadClient.js";
// Load environment variables
dotenv.config();
// Configuration
// Try to find AutoCAD Core Console or use environment variable
const AUTOCAD_CONSOLE_PATH = process.env.AUTOCAD_CONSOLE_PATH || "C:\\Program Files\\Autodesk\\AutoCAD 2026\\accoreconsole.exe";
const SCRIPTS_DIR = process.env.AUTOCAD_SCRIPTS_DIR || path.join(process.cwd(), "scripts");
const execAsync = promisify(exec);
function decodeAutoCADOutput(output) {
    if (output == null)
        return "";
    if (Buffer.isBuffer(output)) {
        const utf16 = output.toString("utf16le").replace(/\u0000/g, "").trim();
        if (utf16)
            return utf16;
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
function cleanAutoCADOutput(output) {
    if (!output)
        return "";
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
function summarizeExecution(stdout, stderr, hadError = false) {
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
const server = new Server({
    name: "autocad-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        resources: {},
        tools: {},
    },
});
/**
 * Helper to list script files in a directory
 */
async function listScripts(dir) {
    const results = [];
    try {
        // Check if directory exists first
        try {
            await fs.access(dir);
        }
        catch {
            return [];
        }
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                const subResults = await listScripts(fullPath);
                results.push(...subResults);
            }
            else if (file.name.endsWith(".scr") || file.name.endsWith(".lsp")) {
                results.push(fullPath);
            }
        }
    }
    catch (error) {
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
            }
        ]
    };
});
// Handler for executing tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // ... existing tools ...
    if (request.params.name === "insert_block") {
        const args = request.params.arguments;
        const result = await sendAutoCADCommand("insert_block", args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
    }
    if (request.params.name === "run_command") {
        const args = request.params.arguments;
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
        }
        catch (e) {
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
        }
        catch (error) {
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
        const args = request.params.arguments;
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
        const args = request.params.arguments;
        const result = await sendAutoCADCommand("create_layer", args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
});
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
