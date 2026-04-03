/**
 * Test: Casa 2 dormitorios — layout manual front-back.
 *
 * Planta (12×10m):
 * ┌────────────────────────────────────────────┐ y=10
 * │ Bedroom 1    │ Bathroom │    Bedroom 2     │
 * │              │          │                  │
 * ├──────────────┴──────────┴──────────────────┤ y=6.00
 * │                 Hall                       │
 * ├────────────────────────────────────────────┤ y=4.65
 * │                                            │
 * │     Sala / Cocina / Comedor (integrado)    │
 * │                                            │
 * └────────────────────────────────────────────┘ y=0
 *  x=0                                     x=12
 */
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { generateLSP, writeLSPToTemp, writeRunScript } from "./lspGenerator.js";
import type { Layout, PlacedRoom } from "./types.js";

const execAsync = promisify(exec);
const TEMP_DIR   = path.join(process.cwd(), "temp");
const OUT_DIR    = path.join(process.cwd(), "outputs");
const ACAD_CONSOLE = process.env.AUTOCAD_CONSOLE_PATH
  || "C:\\Program Files\\Autodesk\\AutoCAD 2026\\accoreconsole.exe";

(async () => {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Casa 2 dormitorios — SOLO PAREDES — lote 12×10m        ║");
  console.log("║  Layout: sala integrada al frente, hall + habs atrás    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ── Lot & wall constants ─────────────────────────────────────
  const lotW = 12, lotD = 10;
  const we = 0.25;  // wall exterior
  const wi = 0.15;  // wall interior

  // ── Manual layout: front-back scheme ─────────────────────────
  //
  // FRONT (south): Sala/Cocina/Comedor integrado
  //   y: we → 4.50   (inner height = 4.25m)
  //
  // Horizontal wall: 4.50 → 4.65
  //
  // HALL (corridor): y: 4.65 → 5.85  (1.20m wide — > 0.90m min path)
  //
  // Horizontal wall: 5.85 → 6.00
  //
  // BACK (north): Bedroom 1 | Bathroom | Bedroom 2
  //   y: 6.00 → lotD - we = 9.75  (inner height = 3.75m)
  //   Bedroom 1:  we → 4.75         (width = 4.50m)
  //   Wall:       4.75 → 4.90
  //   Bathroom:   4.90 → 7.10        (width = 2.20m)
  //   Wall:       7.10 → 7.25
  //   Bedroom 2:  7.25 → lotW - we   (width = 4.50m)

  const rooms: PlacedRoom[] = [
    {
      id: "room_1", label: "Sala / Cocina / Comedor",
      type: "living_kitchen", zone: "public",
      x1: we, y1: we, x2: lotW - we, y2: 4.50,
      area: +(( lotW - 2*we ) * ( 4.50 - we )).toFixed(1),
    },
    {
      id: "room_2", label: "Hall",
      type: "hallway", zone: "transit",
      x1: we, y1: 4.65, x2: lotW - we, y2: 5.85,
      area: +(( lotW - 2*we ) * 1.20).toFixed(1),
    },
    {
      id: "room_3", label: "Dormitorio 1",
      type: "bedroom", zone: "private",
      x1: we, y1: 6.00, x2: 4.75, y2: lotD - we,
      area: +(( 4.75 - we ) * ( lotD - we - 6.00 )).toFixed(1),
    },
    {
      id: "room_4", label: "Baño",
      type: "bathroom", zone: "transit",
      x1: 4.90, y1: 6.00, x2: 7.10, y2: lotD - we,
      area: +(( 7.10 - 4.90 ) * ( lotD - we - 6.00 )).toFixed(1),
    },
    {
      id: "room_5", label: "Dormitorio 2",
      type: "bedroom", zone: "private",
      x1: 7.25, y1: 6.00, x2: lotW - we, y2: lotD - we,
      area: +(( lotW - we - 7.25 ) * ( lotD - we - 6.00 )).toFixed(1),
    },
  ];

  const layout: Layout = {
    lot_width: lotW,
    lot_depth: lotD,
    wall_ext: we,
    wall_int: wi,
    include_terrace: false,
    terrace_depth: 0,
    rooms,
    doors: [],
    windows: [],
  };

  // ── Print summary ────────────────────────────────────────────
  console.log(`Lot: ${lotW}m × ${lotD}m   |  Ext wall: ${we}m  |  Int wall: ${wi}m\n`);
  console.log("── Rooms ──────────────────────────────────────────────");
  for (const r of rooms) {
    const w = (r.x2 - r.x1).toFixed(2);
    const h = (r.y2 - r.y1).toFixed(2);
    console.log(`  [${r.zone.padEnd(8)}] ${r.label.padEnd(26)} ${r.area.toFixed(1).padStart(5)}m²  ${w}×${h}m`);
  }
  const totalArea = rooms.reduce((s, r) => s + r.area, 0);
  console.log(`\n  Total habitable: ${totalArea.toFixed(1)}m²  (lote ${lotW*lotD}m²)`);

  // ── Generate LSP (walls only) ─────────────────────────────
  await fs.mkdir(OUT_DIR,  { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const outputPath = path.join(OUT_DIR, "prueba.dwg");
  const lspCode    = generateLSP(layout, outputPath, { wallsOnly: true });
  const lspPath    = await writeLSPToTemp(lspCode, TEMP_DIR);
  const scrPath    = await writeRunScript(lspPath);

  console.log("\n── Generated Files ────────────────────────────────────");
  console.log(`  LSP: ${lspPath}`);
  console.log(`  SCR: ${scrPath}`);
  console.log(`  DWG: ${outputPath}`);

  // ── Execute via accoreconsole ──────────────────────────────
  const baseDwg = path.join(process.cwd(), "outputs", "pruebas_reglas.dwg");
  try {
    await fs.access(baseDwg);
  } catch {
    console.error(`\n❌ Base drawing not found: ${baseDwg}`);
    console.log("   The LSP and SCR files have been generated. Run them manually in AutoCAD.");
    return;
  }

  try {
    await fs.access(ACAD_CONSOLE);
  } catch {
    console.error(`\n❌ accoreconsole not found: ${ACAD_CONSOLE}`);
    console.log("   Set AUTOCAD_CONSOLE_PATH env var or run the SCR manually in AutoCAD.");
    return;
  }

  console.log("\n── Executing via accoreconsole ─────────────────────────");
  const cmd = `"${ACAD_CONSOLE}" /i "${baseDwg}" /s "${scrPath}"`;
  console.log(`  CMD: ${cmd}\n`);

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stdout) {
      const lines = stdout.split(/\r?\n/).filter(l => l.trim()).slice(-20);
      console.log("  STDOUT (last 20 lines):");
      lines.forEach(l => console.log(`    ${l}`));
    }
    if (stderr) {
      console.log("  STDERR:", stderr.slice(0, 500));
    }
  } catch (err: any) {
    console.error(`  Execution error: ${err.message?.slice(0, 200)}`);
    if (err.stdout) {
      const lines = err.stdout.toString().split(/\r?\n/).filter((l: string) => l.trim()).slice(-15);
      console.log("  STDOUT (last 15 lines):");
      lines.forEach((l: string) => console.log(`    ${l}`));
    }
  }

  // ── Check output ───────────────────────────────────────────
  try {
    const stat = await fs.stat(outputPath);
    console.log(`\n✅ DWG created: ${outputPath} (${(stat.size / 1024).toFixed(0)} KB)`);
  } catch {
    console.log(`\n⚠ DWG not found at ${outputPath} — check accoreconsole output above.`);
  }
})();
