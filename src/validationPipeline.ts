// ─────────────────────────────────────────────────────────────
// Validation Pipeline: TypeScript wrapper for semantic_cad Python
//
// Spawns Python to run the semantic enrichment / validation
// and returns structured results that MCP tools can expose.
// ─────────────────────────────────────────────────────────────
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export interface ValidationCheck {
  rule: string;
  result: "pass" | "warn" | "fail";
  message: string;
  room?: string;
}

export interface DesignQuality {
  design_score: number;
  lighting_score: number;
  circulation_score: number;
  space_efficiency: number;
  room_proportions: number;
}

export interface DetectedRoom {
  label: string;
  area?: number;
  connected_doors?: string[];
  connected_windows?: string[];
}

export interface DetectedOpenings {
  doors: Array<{ handle?: string; position?: { x: number; y: number } }>;
  windows: Array<{ handle?: string; position?: { x: number; y: number } }>;
}

export interface DrawingMetrics {
  total_area: number;
  wall_count: number;
  room_count: number;
  door_count: number;
  window_count: number;
  glazing_ratio?: number;
  circulation_ratio?: number;
}

export interface ValidationResult {
  rooms: DetectedRoom[];
  openings: DetectedOpenings;
  validation: ValidationCheck[];
  design_quality: DesignQuality;
  agent_hints: Record<string, unknown>;
  metrics: DrawingMetrics;
}

/**
 * Run the Python semantic pipeline on a context JSON file.
 * Returns the enriched data.
 */
export async function runSemanticPipeline(
  contextJsonPath: string,
  projectRoot: string
): Promise<Record<string, unknown>> {
  const enrichScript = path.join(projectRoot, "scripts", "semantic_extract.py");

  // Check if the script exists
  try {
    await fs.access(enrichScript);
  } catch {
    throw new Error(`Semantic extraction script not found: ${enrichScript}`);
  }

  // Check if context JSON exists
  try {
    await fs.access(contextJsonPath);
  } catch {
    throw new Error(`Context JSON not found: ${contextJsonPath}`);
  }

  return new Promise((resolve, reject) => {
    const py = spawn("python", [enrichScript], { cwd: projectRoot });
    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (data) => { stdout += data.toString(); });
    py.stderr.on("data", (data) => { stderr += data.toString(); });

    py.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Python semantic pipeline exited with code ${code}: ${stderr}`));
        return;
      }

      // The pipeline writes enriched JSON next to the context file
      const semanticPath = contextJsonPath.replace(".json", ".semantic.json");
      try {
        const data = await fs.readFile(semanticPath, "utf-8");
        resolve(JSON.parse(data));
      } catch (e) {
        // Try reading stdout as JSON fallback
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Could not read semantic output. stderr: ${stderr}`));
        }
      }
    });

    py.on("error", (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

/**
 * Extract validation results from enriched semantic data.
 */
export function extractValidation(enriched: Record<string, unknown>): ValidationResult {
  const rooms = (enriched.rooms ?? []) as DetectedRoom[];
  const openings = (enriched.openings ?? { doors: [], windows: [] }) as DetectedOpenings;
  const validation = (enriched.validation ?? []) as ValidationCheck[];
  const design_quality = (enriched.design_quality ?? {
    design_score: 0.5, lighting_score: 0.5, circulation_score: 0.5,
    space_efficiency: 0.5, room_proportions: 0.5,
  }) as DesignQuality;
  const agent_hints = (enriched.agent_hints ?? {}) as Record<string, unknown>;

  const metrics: DrawingMetrics = {
    total_area: rooms.reduce((sum, r) => sum + (r.area ?? 0), 0),
    wall_count: ((enriched.walls ?? []) as unknown[]).length,
    room_count: rooms.length,
    door_count: openings.doors.length,
    window_count: openings.windows.length,
    glazing_ratio: undefined,
    circulation_ratio: undefined,
  };

  // Compute glazing ratio (window area / wall area) — approximate
  if (metrics.total_area > 0) {
    const windowArea = metrics.window_count * 2.0 * 1.2; // approx 2m wide x 1.2m tall
    const envelope = Math.sqrt(metrics.total_area) * 4 * 2.8; // approx perimeter * height
    metrics.glazing_ratio = envelope > 0 ? parseFloat((windowArea / envelope).toFixed(3)) : 0;

    // Circulation ratio
    const hallRooms = rooms.filter(r => (r.label ?? "").toLowerCase().includes("hall"));
    const hallArea = hallRooms.reduce((sum, r) => sum + (r.area ?? 0), 0);
    metrics.circulation_ratio = parseFloat((hallArea / metrics.total_area).toFixed(3));
  }

  return { rooms, openings, validation, design_quality, agent_hints, metrics };
}

/**
 * Validate a drawing by running the full pipeline.
 * Requires a context JSON file (typically extracted by extract_context.lsp).
 */
export async function validateDrawing(
  contextJsonPath: string,
  projectRoot: string
): Promise<ValidationResult> {
  const enriched = await runSemanticPipeline(contextJsonPath, projectRoot);
  return extractValidation(enriched);
}

/**
 * Quick validation from in-memory layout data (no Python needed).
 * Uses the same rules as architecture_rules.md.
 */
export function validateLayoutQuick(layout: {
  rooms: Array<{ label: string; type: string; x1: number; y1: number; x2: number; y2: number }>;
  doors: Array<{ x: number; y: number; width: number }>;
  windows: Array<{ x: number; y: number; width: number }>;
  lot_width: number;
  lot_depth: number;
}): { checks: ValidationCheck[]; score: number } {
  const checks: ValidationCheck[] = [];

  const MIN_AREAS: Record<string, number> = {
    bedroom: 8.0, master_bedroom: 11.0, bathroom: 3.0, half_bath: 2.0,
    living_room: 12.0, kitchen: 6.0, dining_room: 8.0, hallway: 3.0,
  };

  for (const room of layout.rooms) {
    const w = Math.abs(room.x2 - room.x1);
    const h = Math.abs(room.y2 - room.y1);
    const area = w * h;
    const minArea = MIN_AREAS[room.type];

    if (minArea && area < minArea) {
      checks.push({
        rule: "min_area",
        result: area < minArea * 0.8 ? "fail" : "warn",
        message: `${room.label}: area ${area.toFixed(1)}m² < min ${minArea}m²`,
        room: room.label,
      });
    } else {
      checks.push({ rule: "min_area", result: "pass", message: `${room.label}: area OK (${area.toFixed(1)}m²)`, room: room.label });
    }

    // Aspect ratio check
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (aspect > 2.5) {
      checks.push({ rule: "aspect_ratio", result: "warn", message: `${room.label}: aspect ratio ${aspect.toFixed(1)} > 2.5`, room: room.label });
    }
  }

  // Lot coverage
  const totalRoomArea = layout.rooms.reduce((s, r) => s + Math.abs(r.x2 - r.x1) * Math.abs(r.y2 - r.y1), 0);
  const lotArea = layout.lot_width * layout.lot_depth;
  const coverage = totalRoomArea / lotArea;
  if (coverage > 0.85) {
    checks.push({ rule: "lot_coverage", result: "warn", message: `Lot coverage ${(coverage * 100).toFixed(0)}% > 85%` });
  }

  // Door count sanity
  if (layout.doors.length < layout.rooms.length - 1) {
    checks.push({ rule: "door_count", result: "warn", message: `Only ${layout.doors.length} doors for ${layout.rooms.length} rooms` });
  }

  // Window check
  const roomsNeedingWindows = layout.rooms.filter(r => !["hallway", "terrace"].includes(r.type));
  if (layout.windows.length < roomsNeedingWindows.length * 0.5) {
    checks.push({ rule: "window_count", result: "warn", message: `Only ${layout.windows.length} windows for ${roomsNeedingWindows.length} rooms that need natural light` });
  }

  const passes = checks.filter(c => c.result === "pass").length;
  const warns = checks.filter(c => c.result === "warn").length;
  const score = checks.length > 0 ? Math.round(((passes + warns * 0.5) / checks.length) * 100) : 50;

  return { checks, score };
}
