/**
 * Quick smoke-test for the generate_house_plan pipeline.
 * Runs both NLP and structured-JSON inputs, prints layout + generated LSP.
 * Usage: npx ts-node src/test_generate.ts
 */
import path from "path";
import fs from "fs/promises";
import { resolveHouseSpec } from "./nlpParser.js";
import { generateLayout } from "./layoutEngine.js";
import { generateLSP, writeLSPToTemp, writeRunScript } from "./lspGenerator.js";

const BLOCKS_DIR = path.join(process.cwd(), "blocks");
const TEMP_DIR   = path.join(process.cwd(), "temp");
const OUT_DIR    = path.join(process.cwd(), "outputs");

async function run(label: string, input: unknown, overrides: Record<string, unknown> = {}) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`TEST: ${label}`);
  console.log("═".repeat(70));

  const spec = resolveHouseSpec(input as any, overrides as any);

  console.log("\n── HouseSpec ─────────────────────────────────────────────────────────");
  console.log(`  Lot:   ${spec.lot_width}m × ${spec.lot_depth}m`);
  console.log(`  Style: ${spec.style}`);
  console.log(`  Rooms: ${spec.rooms.map(r => `${r.count}×${r.type}`).join(", ")}`);

  const { layout, warnings } = generateLayout(spec, BLOCKS_DIR);

  console.log("\n── Layout Rooms ──────────────────────────────────────────────────────");
  for (const r of layout.rooms) {
    console.log(`  [${r.zone.padEnd(8)}] ${r.label.padEnd(20)} ${r.area.toFixed(1)}m²  (${r.x1.toFixed(2)},${r.y1.toFixed(2)})→(${r.x2.toFixed(2)},${r.y2.toFixed(2)})`);
  }

  console.log("\n── Openings ──────────────────────────────────────────────────────────");
  console.log(`  Doors:   ${layout.doors.length}`);
  console.log(`  Windows: ${layout.windows.length}`);

  if (warnings.length > 0) {
    console.log("\n── ⚠ Warnings ────────────────────────────────────────────────────────");
    warnings.forEach(w => console.log(`  ! ${w}`));
  }

  // Generate and write LSP
  await fs.mkdir(OUT_DIR,  { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const timestamp  = Date.now();
  const outputPath = path.join(OUT_DIR, `test_${label.replace(/\s+/g, "_")}_${timestamp}.dwg`);
  const lspCode    = generateLSP(layout, outputPath);
  const lspPath    = await writeLSPToTemp(lspCode, TEMP_DIR);
  const scrPath    = await writeRunScript(lspPath);

  console.log("\n── Generated Files ───────────────────────────────────────────────────");
  console.log(`  LSP: ${lspPath}`);
  console.log(`  SCR: ${scrPath}`);
  console.log(`  DWG: ${outputPath}`);

  // Print first 60 lines of LSP for review
  const lspLines = lspCode.split("\n");
  console.log(`\n── LSP Preview (first 60 lines of ${lspLines.length} total) ──────────────────`);
  lspLines.slice(0, 60).forEach((l, i) => console.log(`  ${String(i + 1).padStart(3)}: ${l}`));
  if (lspLines.length > 60) console.log(`  ... (${lspLines.length - 60} more lines)`);
}

(async () => {
  // Test 1: NLP free-text
  await run(
    "NLP_casa3d2b",
    "casa de 3 dormitorios, 2 baños, cocina-sala abierta, lote 12x9"
  );

  // Test 2: Structured override (client request)
  await run(
    "structured_client",
    "client request",
    {
      lot_width: 10,
      lot_depth: 8,
      rooms: [
        { type: "master_bedroom", count: 1 },
        { type: "bedroom",        count: 2 },
        { type: "bathroom",       count: 2 },
        { type: "living_kitchen", count: 1 },
        { type: "hallway",        count: 1 },
      ],
      style: "linear",
    }
  );
})();
