// ─────────────────────────────────────────────────────────────
// LSP Generator: converts a Layout to a runnable AutoLISP script
//
// Follows the exact patterns from make_house_rules_blocks_v3.lsp:
//   1. Setup (CMDECHO=0, OSMODE=0, erase all)
//   2. Layers (WALLS/DOORS/WINDOWS/FLOOR/DIMENSIONS/TEXT)
//   3. Floor outline (RECTANG on FLOOR layer)
//   4. Wall shell (reg-rect on WALLS layer)
//   5. SUBTRACT room voids
//   6. SUBTRACT door + window openings
//   7. INSERT block references
//   8. TEXT labels
//   9. SAVEAS R2018
// ─────────────────────────────────────────────────────────────
import fs from "fs/promises";
import path from "path";
// ── Helpers ────────────────────────────────────────────────────
function n(v) {
    // Always use dot as decimal separator, 3 decimals
    return v.toFixed(3);
}
function pt(x, y) {
    return `(list ${n(x)} ${n(y)} 0.0)`;
}
function toDwgPath(p) {
    // AutoLISP needs forward slashes
    return p.replace(/\\/g, "/");
}
// Centroid of a placed room
function centroid(r) {
    return [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2];
}
// ── Layer definitions ──────────────────────────────────────────
const LAYERS = [
    { name: "WALLS", color: "7", lw: "0.40" },
    { name: "DOORS", color: "3", lw: "0.30" },
    { name: "WINDOWS", color: "4", lw: "0.25" },
    { name: "FLOOR", color: "8", lw: "0.15" },
    { name: "DIMENSIONS", color: "2", lw: "0.18" },
    { name: "TEXT", color: "7", lw: "0.15" },
];
// ── Code builders ──────────────────────────────────────────────
function buildHeader() {
    return `(vl-load-com)

;;; ── reg-rect helper ─────────────────────────────────────────────────────
;;; Creates a single rectangular REGION from four corner coordinates
(defun reg-rect (x1 y1 x2 y2 / e)
  (command "._RECTANG" (list x1 y1) (list x2 y2))
  (command "._REGION" (entlast) "")
  (setq e (entlast))
)

;;; ── insblk helper ────────────────────────────────────────────────────────
;;; Inserts a block by full file path at the given point with sx/sy scale & rotation
(defun insblk (filePath inspt sx sy rot)
  (command "._-INSERT" filePath inspt sx sy rot)
)

(defun c:GenerateHousePlan ( / ss shell outpath)
  (setvar "CMDECHO" 0)
  (setvar "OSMODE"  0)
`;
}
function buildClear() {
    return `
  ;; ── Clear drawing ──────────────────────────────────────────────────────
  (setvar "CLAYER" "0")
  (setq ss (ssget "X"))
  (if ss (command "._ERASE" ss ""))
`;
}
function buildLayers() {
    let s = `\n  ;; ── Layer setup ───────────────────────────────────────────────────────\n`;
    for (const l of LAYERS) {
        s += `  (command "._LAYER" "_M" "${l.name}" "_C" "${l.color}" "" "_LW" "${l.lw}" "" "")\n`;
    }
    return s;
}
function buildFloor(layout) {
    const { lot_width: w, lot_depth: d, include_terrace, terrace_depth } = layout;
    let s = `\n  ;; ── Floor outlines (FLOOR layer) ──────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "FLOOR")\n`;
    s += `  (command "._RECTANG" "0,0" "${n(w)},${n(d)}")\n`;
    if (include_terrace && terrace_depth > 0) {
        s += `  (command "._RECTANG" "0,${n(d)}" "${n(w)},${n(d + terrace_depth)}")\n`;
    }
    return s;
}
function buildWallShell(layout) {
    const { lot_width: w, lot_depth: d, wall_ext: e } = layout;
    let s = `\n  ;; ── Wall shell — main body ────────────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "WALLS")\n`;
    s += `  (setq shell (reg-rect 0.0 0.0 ${n(w)} ${n(d)}))\n`;
    if (layout.include_terrace && layout.terrace_depth > 0) {
        // Terrace shell is a separate region (thin border, not full mass)
        s += `  ;; terrace shell\n`;
        s += `  (setq terrace-shell (reg-rect 0.0 ${n(d)} ${n(w)} ${n(d + layout.terrace_depth)}))\n`;
    }
    return s;
}
function buildRoomVoids(rooms) {
    let s = `\n  ;; ── Room voids ────────────────────────────────────────────────────────\n`;
    const mainRooms = rooms.filter(r => r.type !== "terrace");
    const varNames = [];
    for (const r of mainRooms) {
        const varName = `void-${r.id.replace(/_/g, "-")}`;
        varNames.push(varName);
        s += `  ;; ${r.label}\n`;
        s += `  (setq ${varName} (reg-rect ${n(r.x1)} ${n(r.y1)} ${n(r.x2)} ${n(r.y2)}))\n`;
    }
    if (varNames.length > 0) {
        s += `  (command "._SUBTRACT" shell ""\n`;
        for (const v of varNames) {
            s += `    ${v}\n`;
        }
        s += `    "")\n`;
    }
    // Terrace void if exists
    const terrace = rooms.find(r => r.type === "terrace");
    if (terrace) {
        s += `  ;; terrace void\n`;
        s += `  (setq void-terrace (reg-rect ${n(terrace.x1)} ${n(terrace.y1)} ${n(terrace.x2)} ${n(terrace.y2)}))\n`;
        s += `  (command "._SUBTRACT" terrace-shell "" void-terrace "")\n`;
    }
    return s;
}
function buildOpenings(doors, windows) {
    let s = `\n  ;; ── Door openings (cut in shell) ─────────────────────────────────────\n`;
    for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        const v = `op-door-${i}`;
        s += `  (setq ${v} (reg-rect ${n(d.cutX1)} ${n(d.cutY1)} ${n(d.cutX2)} ${n(d.cutY2)}))\n`;
    }
    if (doors.length > 0) {
        s += `  (command "._SUBTRACT" shell ""\n`;
        for (let i = 0; i < doors.length; i++) {
            s += `    op-door-${i}\n`;
        }
        s += `    "")\n`;
    }
    s += `\n  ;; ── Window openings (cut in shell) ───────────────────────────────────\n`;
    const windowsOnMain = windows.filter(w => !["N", "S"].includes(w.facing) ||
        true // include all for now
    );
    for (let i = 0; i < windowsOnMain.length; i++) {
        const w = windowsOnMain[i];
        const v = `op-win-${i}`;
        s += `  (setq ${v} (reg-rect ${n(w.cutX1)} ${n(w.cutY1)} ${n(w.cutX2)} ${n(w.cutY2)}))\n`;
    }
    if (windowsOnMain.length > 0) {
        s += `  (command "._SUBTRACT" shell ""\n`;
        for (let i = 0; i < windowsOnMain.length; i++) {
            s += `    op-win-${i}\n`;
        }
        s += `    "")\n`;
    }
    return s;
}
function buildBlockInserts(doors, windows) {
    let s = `\n  ;; ── Door block inserts ────────────────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "DOORS")\n`;
    for (const d of doors) {
        const bp = toDwgPath(d.blockPath);
        s += `  (insblk "${bp}" ${pt(d.x, d.y)} 1 1 ${n(d.rotation)})\n`;
    }
    s += `\n  ;; ── Window block inserts ──────────────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "WINDOWS")\n`;
    for (const w of windows) {
        const bp = toDwgPath(w.blockPath);
        // Scale based on window width relative to 2m base block
        const sx = parseFloat((w.width / 2.0).toFixed(3));
        const sy = sx; // uniform scale
        s += `  (insblk "${bp}" ${pt(w.x, w.y)} ${n(sx)} ${n(sy)} ${n(w.rotation)})\n`;
    }
    return s;
}
// Window geometry is now handled by block inserts in buildBlockInserts()
function buildLabels(rooms) {
    let s = `\n  ;; ── Room labels ───────────────────────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "TEXT")\n`;
    for (const r of rooms) {
        const [cx, cy] = centroid(r);
        const fontSize = r.type === "hallway" ? 0.20
            : r.type === "terrace" ? 0.22
                : 0.28;
        s += `  (entmake '((0 . "TEXT") (8 . "TEXT")\n`;
        s += `    (10 ${n(cx)} ${n(cy)} 0.0) (11 ${n(cx)} ${n(cy)} 0.0)\n`;
        s += `    (40 . ${n(fontSize)}) (1 . "${r.label}") (72 . 1) (73 . 2)))\n`;
    }
    return s;
}
function buildDimensions(layout) {
    const { lot_width: w, lot_depth: d, include_terrace, terrace_depth } = layout;
    let s = `\n  ;; ── Dimensions ────────────────────────────────────────────────────────\n`;
    s += `  (setvar "CLAYER" "DIMENSIONS")\n`;
    // Horizontal dimension (bottom)
    s += `  (command "._DIMLINEAR" "0,0" "${n(w)},0" "_H" "${n(w / 2)},${n(-1.5)}")\n`;
    // Vertical dimension (right)
    s += `  (command "._DIMLINEAR" "${n(w)},0" "${n(w)},${n(d)}" "_V" "${n(w + 1.5)},${n(d / 2)}")\n`;
    // Terrace depth
    if (include_terrace && terrace_depth > 0) {
        s += `  (command "._DIMLINEAR" "${n(w)},${n(d)}" "${n(w)},${n(d + terrace_depth)}" "_V" "${n(w + 1.5)},${n(d + terrace_depth / 2)}")\n`;
    }
    return s;
}
function buildSave(outputPath) {
    const p = toDwgPath(outputPath);
    return `
  ;; ── Save drawing ───────────────────────────────────────────────────────
  (setvar "FILEDIA" 0)
  (setq outpath "${p}")
  (if (findfile outpath)
    (progn
      (command "._SAVEAS" "2018" outpath "_Y")
    )
    (command "._SAVEAS" "2018" outpath)
  )
  (setvar "FILEDIA" 1)
  (command "._ZOOM" "_E")
  (princ (strcat "\\nSaved: " outpath "\\n"))
  (princ)
)

;; Auto-run on load
(c:GenerateHousePlan)
`;
}
/**
 * Generate the full AutoLISP script from a computed Layout.
 */
export function generateLSP(layout, outputPath, opts) {
    const wallsOnly = opts?.wallsOnly ?? false;
    const sections = [
        buildHeader(),
        buildClear(),
        buildLayers(),
        buildFloor(layout),
        buildWallShell(layout),
        buildRoomVoids(layout.rooms),
    ];
    if (!wallsOnly) {
        sections.push(buildOpenings(layout.doors, layout.windows));
        sections.push(buildBlockInserts(layout.doors, layout.windows));
    }
    sections.push(buildLabels(layout.rooms));
    sections.push(buildDimensions(layout));
    sections.push(buildSave(outputPath));
    return sections.join("");
}
/**
 * Write LSP to a temp file and return its path.
 */
export async function writeLSPToTemp(lspCode, tempDir) {
    await fs.mkdir(tempDir, { recursive: true });
    const timestamp = Date.now();
    const lspPath = path.join(tempDir, `gen_${timestamp}.lsp`);
    await fs.writeFile(lspPath, lspCode, "utf-8");
    return lspPath;
}
/**
 * Build a .scr script that loads and runs the generated .lsp.
 * accoreconsole can run a .scr file directly.
 */
export function buildRunScript(lspPath) {
    const p = toDwgPath(lspPath);
    return `(load "${p}")\n`;
}
/**
 * Write the .scr file next to the .lsp and return its path.
 */
export async function writeRunScript(lspPath) {
    const scrPath = lspPath.replace(/\.lsp$/, ".scr");
    const content = buildRunScript(lspPath);
    await fs.writeFile(scrPath, content, "utf-8");
    return scrPath;
}
