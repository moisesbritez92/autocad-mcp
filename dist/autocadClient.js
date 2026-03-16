import axios from 'axios';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
const PLUGIN_URL = process.env.AUTOCAD_PLUGIN_URL || "http://localhost:12345";
export async function sendAutoCADCommand(command, args = {}) {
    try {
        const response = await axios.post(PLUGIN_URL, {
            command,
            args
        }, {
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
