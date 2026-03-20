import axios from 'axios';
import path from 'path';
const PLUGIN_URL = "http://localhost:12345";
const AUTH_TOKEN = process.env.MCP_AUTOCAD_TOKEN || "default-secret-token";
// Helper to wrap requests
async function sendCmd(command, args = {}) {
    try {
        console.log(`\n➤ Sending '${command}'...`);
        const response = await axios.post(PLUGIN_URL, {
            command,
            args
        }, {
            headers: { "Authorization": `Bearer ${AUTH_TOKEN}` },
            timeout: 10000
        });
        console.log(`   ✅ Success:`, JSON.stringify(response.data));
        return response.data;
    }
    catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        if (error.response)
            console.error(`   Server says:`, error.response.data);
    }
}
async function runTests() {
    console.log("=== AutoCAD Advanced Plugin Test ===");
    // 1. Check connection and layers
    await sendCmd("get_layers");
    // 2. Create a new layer for our test
    await sendCmd("create_layer", { name: "TEST_MCP_LAYER" });
    // 3. Draw a line on that layer (Note: Plugin CreateLine might need updating to support layer arg, 
    //    but for now it draws on active layer. We can use run_command to set layer first)
    // 4. Use run_command to set current layer
    await sendCmd("run_command", { command: "(setvar \"CLAYER\" \"TEST_MCP_LAYER\")" });
    // 5. Insert a block (Door example)
    //    Note: Update path to match your actual block path
    const blockPath = path.resolve("blocks/doors/puerta_09.dwg"); // Adjust if needed
    await sendCmd("insert_block", {
        blockName: "Puerta_Test",
        blockPath: blockPath,
        x: 50,
        y: 50,
        scale: 1.0,
        rotation: 45
    });
    // 6. Run a simple LISP alert to prove interaction
    await sendCmd("run_command", { command: "(alert \"Hello from MCP!\")" });
    console.log("\n=== Test Complete ===");
}
runTests();
