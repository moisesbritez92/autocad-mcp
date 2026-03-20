import axios from 'axios';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
const PLUGIN_URL = process.env.AUTOCAD_PLUGIN_URL || "http://localhost:12345";
const AUTH_TOKEN = process.env.MCP_AUTOCAD_TOKEN || "default-secret-token";
/**
 * Checks whether the AutoCAD plugin is reachable (non-throwing).
 * Returns true if the plugin responds with any HTTP status ≤ 499.
 */
export async function isPluginAvailable() {
    try {
        // We deliberately send a request and accept any 4xx (auth/method) as "alive"
        await axios.post(PLUGIN_URL, { command: "__ping__", args: {} }, {
            headers: { "Authorization": `Bearer ${AUTH_TOKEN}` },
            timeout: 2000,
            validateStatus: s => s < 500,
        });
        return true;
    }
    catch {
        return false;
    }
}
export async function sendAutoCADCommand(command, args = {}) {
    try {
        const response = await axios.post(PLUGIN_URL, {
            command,
            args
        }, {
            headers: {
                "Authorization": `Bearer ${AUTH_TOKEN}`
            },
            timeout: 5000 // 5 seconds timeout
        });
        if (response.data && response.data.error) {
            throw new Error(`Plugin Error: ${response.data.error}`);
        }
        return response.data;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED') {
                throw new McpError(ErrorCode.InternalError, "Could not connect to AutoCAD Plugin. Is AutoCAD running with the plugin loaded?");
            }
            throw new McpError(ErrorCode.InternalError, `AutoCAD Plugin Request Failed: ${error.message}`);
        }
        throw error;
    }
}
