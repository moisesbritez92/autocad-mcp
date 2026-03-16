import axios from 'axios';

const PLUGIN_URL = "http://localhost:12345";
const AUTH_TOKEN = process.env.MCP_AUTOCAD_TOKEN || "default-secret-token";

async function testConnection() {
    console.log(`Testing connection to ${PLUGIN_URL}...`);
    
    try {
        // Test 1: Create a Line
        console.log("Sending 'create_line' command...");
        const response = await axios.post(PLUGIN_URL, {
            command: "create_line",
            args: {
                startX: 0,
                startY: 0,
                endX: 100,
                endY: 100
            }
        }, {
            headers: { "Authorization": `Bearer ${AUTH_TOKEN}` },
            timeout: 5000
        });

        console.log("✅ Response:", response.data);
        console.log("Check your AutoCAD window for a line from (0,0) to (100,100)!");

        // Test 2: Get Layers
        console.log("\nSending 'get_layers' command...");
        const layersResp = await axios.post(PLUGIN_URL, {
            command: "get_layers",
            args: {}
        }, {
            headers: { "Authorization": `Bearer ${AUTH_TOKEN}` },
            timeout: 5000
        });
        
        console.log("✅ Layers found:", layersResp.data);

    } catch (error: any) {
        console.error("❌ Connection failed!");
        if (error.code === 'ECONNREFUSED') {
            console.error("Could not connect. Is the AutoCAD plugin loaded and listening?");
        } else {
            console.error(error.message);
            if (error.response) {
                console.error("Status:", error.response.status);
                console.error("Data:", error.response.data);
            }
        }
    }
}

testConnection();
