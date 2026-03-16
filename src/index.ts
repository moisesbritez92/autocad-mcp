import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration
// Try to find AutoCAD Core Console or use environment variable
const AUTOCAD_CONSOLE_PATH = process.env.AUTOCAD_CONSOLE_PATH || "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const SCRIPTS_DIR = process.env.AUTOCAD_SCRIPTS_DIR || path.join(process.cwd(), "scripts");

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "autocad-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
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

// Handler for listing tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_script",
        description: "Executes an AutoCAD script (.scr) against a drawing (.dwg) using accoreconsole.",
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
      }
    ]
  };
});

// Handler for executing tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "list_available_scripts") {
    const scripts = await listScripts(SCRIPTS_DIR);
    return {
      content: [{
        type: "text",
        text: `Available Scripts in ${SCRIPTS_DIR}:\n${scripts.join("\n") || "No scripts found."}`
      }]
    };
  }

  if (request.params.name === "execute_script") {
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
      const { stdout, stderr } = await execAsync(command, { timeout: timeoutSec * 1000 });
      
      return {
        content: [
          {
            type: "text",
            text: `Execution Completed.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing script: ${error.message}\n\nSTDOUT:\n${error.stdout || ''}\n\nSTDERR:\n${error.stderr || ''}`
          }
        ],
        isError: true
      };
    }
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
