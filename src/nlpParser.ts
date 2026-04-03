// ─────────────────────────────────────────────────────────────
// NLP Parser: converts free-text OR structured JSON to HouseSpec
// ─────────────────────────────────────────────────────────────
import type { HouseSpec, RoomSpec, RoomType, StylePreference } from "./types.js";

// ── Minimum areas from architecture_rules.md ─────────────────
const MIN_AREAS: Partial<Record<RoomType, number>> = {
  bedroom: 8.0,
  master_bedroom: 11.0,
  bathroom: 3.5,
  half_bath: 2.0,
  living_room: 18.0,
  living_dining: 18.0,
  living_kitchen: 18.0,
  kitchen: 6.0,
  dining_room: 8.0,
  hallway: 3.0,
  study: 7.0,
  terrace: 6.0,
  garage: 15.0,
};

// ── Default counts when not specified ─────────────────────────
const DEFAULT_ROOMS: RoomSpec[] = [
  { type: "living_kitchen", count: 1 },
  { type: "bedroom", count: 2 },
  { type: "bathroom", count: 1 },
  { type: "hallway", count: 1 },
];

// ── Type checking guard ────────────────────────────────────────
export function isStructuredInput(input: unknown): input is Partial<HouseSpec> {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    ("lot_width" in obj || "lot_depth" in obj || "rooms" in obj) &&
    typeof input === "object"
  );
}

// ── Pattern tables for Spanish + English ──────────────────────
const ROOM_PATTERNS: Array<{ pattern: RegExp; type: RoomType }> = [
  // Master bedroom first (more specific)
  { pattern: /\b(master\s*bed(?:room)?|dormitorio\s*principal|recámara\s*principal|suite)\b/i, type: "master_bedroom" },
  // Bedrooms (with explicit count: "3 dormitorios")
  { pattern: /\b(\d+)\s*(?:bed(?:room)?s?|dormitorio[s]?|recámara[s]?|habitacion(?:es)?|cuarto[s]?\s*(?:de\s*dormir)?)\b/i, type: "bedroom" },
  { pattern: /\b(bed(?:room)?|dormitorio|recámara|habitacion|cuarto\s*(?:de\s*dormir)?)\b/i, type: "bedroom" },
  // Bathrooms (with explicit count: "2 baños")
  { pattern: /\b(\d+)\s*(?:bath(?:room)?s?|baño[s]?|sanitario[s]?)\b/i, type: "bathroom" },
  { pattern: /\b(half\s*bath|medio\s*baño|aseo|powder\s*room)\b/i, type: "half_bath" },
  { pattern: /\b(bath(?:room)?|baño|sanitario)\b/i, type: "bathroom" },
  // Compound living spaces — MUST come before single-word patterns
  { pattern: /\b(living[\s\/\-](?:dining|comedor)|sala[\s\/\-]comedor|comedor[\s\/\-]sala)\b/i, type: "living_dining" },
  { pattern: /\b(living[\s\/\-]kitchen|sala[\s\/\-]cocina|cocina[\s\/\-]sala|open[\s\-](?:plan|concept)|sala[\s\/\-]estar[\s\/\-]cocina)\b/i, type: "living_kitchen" },
  // Single living/kitchen — only if no compound was matched at same position
  { pattern: /\b(living\s*room|sala(?:\s*de\s*estar)?|estancia)\b/i, type: "living_room" },
  { pattern: /\b(comedor|dining\s*room)\b/i, type: "dining_room" },
  { pattern: /\b(cocina|kitchen)\b/i, type: "kitchen" },
  // Others
  { pattern: /\b(hall(?:way)?|corredor|pasillo|vestíbulo)\b/i, type: "hallway" },
  { pattern: /\b(study|estudio|oficina|despacho|home\s*office)\b/i, type: "study" },
  { pattern: /\b(terraza|terrace|balcón|balcony|patio)\b/i, type: "terrace" },
  { pattern: /\b(garage|garaje|cochera|estacionamiento)\b/i, type: "garage" },
];

const DEFAULT_LABELS: Record<RoomType, string> = {
  bedroom: "Bedroom",
  master_bedroom: "Master Bedroom",
  bathroom: "Bathroom",
  half_bath: "Half Bath",
  living_room: "Living Room",
  dining_room: "Dining Room",
  kitchen: "Kitchen",
  living_dining: "Living / Dining",
  living_kitchen: "Living / Kitchen",
  hallway: "Hall",
  study: "Study",
  terrace: "Terrace",
  garage: "Garage",
};

// ── Dimension patterns ────────────────────────────────────────
// Matches: "10x8", "10 x 8", "10×8", "10m x 8m", "10 por 8", "10m2  de largo"
const DIM_PATTERN  = /(\d+(?:\.\d+)?)\s*(?:m(?:etros?)?)?[xX×]\s*(\d+(?:\.\d+)?)/;
const AREA_PATTERN = /(\d+(?:\.\d+)?)\s*m[²2]/;
const STYLE_MAP: Record<string, StylePreference> = {
  compacto: "compact", compact: "compact",
  lineal: "linear", linear: "linear",
  abierto: "open", open: "open",
};

function extractDimensions(text: string): { width?: number; depth?: number; inferredFromArea?: boolean } {
  const dimMatch = text.match(DIM_PATTERN);
  if (dimMatch) {
    return { width: parseFloat(dimMatch[1]), depth: parseFloat(dimMatch[2]) };
  }
  // Try to infer from area: "80m²", "100 m2" → assume roughly square
  const areaMatch = text.match(AREA_PATTERN);
  if (areaMatch) {
    const area = parseFloat(areaMatch[1]);
    const side = Math.sqrt(area);
    return { width: parseFloat(side.toFixed(1)), depth: parseFloat(side.toFixed(1)), inferredFromArea: true };
  }
  return {};
}

function extractStyle(text: string): StylePreference | undefined {
  for (const [key, val] of Object.entries(STYLE_MAP)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(text)) return val;
  }
  return undefined;
}

// Track which character ranges were already claimed by a compound pattern
// so that single-word fallbacks don't double-count the same text.
interface MatchRange { start: number; end: number; type: RoomType }

function extractRooms(text: string): RoomSpec[] {
  const found: Map<RoomType, number> = new Map();
  const claimedRanges: MatchRange[] = [];

  for (const { pattern, type } of ROOM_PATTERNS) {
    const global = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      const matchStart = m.index;
      const matchEnd   = m.index + m[0].length;

      // If this range overlaps an already-claimed compound match, skip
      const overlaps = claimedRanges.some(
        r => matchStart < r.end && matchEnd > r.start
      );
      if (overlaps) continue;

      // Extract count: prefer a digit AT THE START of the match ("3 dormitorios")
      // then fall back to a digit immediately before the match.
      const matchLeading = m[0].match(/^(\d+)\s*/);
      const beforeMatch  = text.slice(Math.max(0, matchStart - 10), matchStart);
      const leadingBefore = beforeMatch.match(/(\d+)\s*$/);

      const count = matchLeading  ? parseInt(matchLeading[1])
                  : leadingBefore ? parseInt(leadingBefore[1])
                  : 1;

      // Claim this range so single-word fallbacks don't overlap
      claimedRanges.push({ start: matchStart, end: matchEnd, type });

      if (!found.has(type)) {
        found.set(type, count);
      } else {
        found.set(type, Math.max(found.get(type)!, count));
      }
    }
  }

  // Convert to RoomSpec array
  const specs: RoomSpec[] = [];
  for (const [type, count] of found.entries()) {
    specs.push({
      type,
      count,
      min_area: MIN_AREAS[type],
      label: DEFAULT_LABELS[type],
    });
  }
  return specs;
}

/**
 * Parse a free-text house description to HouseSpec.
 * Falls back on defaults for any missing dimension or room.
 */
export function parseHouseDescription(text: string): HouseSpec {
  const { width, depth } = extractDimensions(text);
  const style = extractStyle(text);
  let rooms = extractRooms(text);

  // Merge living_room + kitchen if both present → upgrade to living_kitchen
  const hasLivingRoom = rooms.some(r => r.type === "living_room");
  const hasKitchen    = rooms.some(r => r.type === "kitchen");
  if (hasLivingRoom && hasKitchen) {
    rooms = rooms.filter(r => r.type !== "living_room" && r.type !== "kitchen");
    rooms.push({ type: "living_kitchen", count: 1, label: DEFAULT_LABELS["living_kitchen"] });
  }

  // Apply defaults for rooms if nothing specific was found
  if (rooms.length === 0) {
    rooms = DEFAULT_ROOMS.map(r => ({ ...r, label: DEFAULT_LABELS[r.type] }));
  } else {
    // Ensure there's always a hallway and at least one living area
    const hasLiving = rooms.some(r =>
      ["living_room", "living_dining", "living_kitchen"].includes(r.type));
    const hasHall = rooms.some(r => r.type === "hallway");

    if (!hasLiving) {
      rooms.push({ type: "living_kitchen", count: 1, label: DEFAULT_LABELS["living_kitchen"] });
    }
    if (!hasHall) {
      rooms.push({ type: "hallway", count: 1, label: DEFAULT_LABELS["hallway"] });
    }
  }

  return {
    lot_width: width ?? 10,
    lot_depth: depth ?? 8,
    rooms,
    style: style ?? "linear",
    include_terrace: true,
    terrace_depth: 2.0,
    wall_thickness_exterior: 0.25,
    wall_thickness_interior: 0.15,
  };
}

/**
 * Normalise any input (NLP string, JSON string, or partial HouseSpec object)
 * into a fully-populated HouseSpec.
 */
export function resolveHouseSpec(
  input: string | Record<string, unknown>,
  overrides: Partial<HouseSpec> = {}
): HouseSpec {
  let base: HouseSpec;

  if (typeof input === "string") {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(input) as unknown;
      if (isStructuredInput(parsed)) {
        base = mergeWithDefaults(parsed);
      } else {
        base = parseHouseDescription(input);
      }
    } catch {
      base = parseHouseDescription(input);
    }
  } else if (isStructuredInput(input)) {
    base = mergeWithDefaults(input);
  } else {
    base = parseHouseDescription(JSON.stringify(input));
  }

  // Apply explicit overrides
  return {
    ...base,
    ...overrides,
    rooms: overrides.rooms ?? base.rooms,
  };
}

function mergeWithDefaults(partial: Partial<HouseSpec>): HouseSpec {
  const rooms: RoomSpec[] = (partial.rooms ?? DEFAULT_ROOMS).map(r => ({
    ...r,
    min_area: r.min_area ?? MIN_AREAS[r.type],
    label: r.label ?? DEFAULT_LABELS[r.type] ?? r.type,
  }));

  return {
    lot_width: partial.lot_width ?? 10,
    lot_depth: partial.lot_depth ?? 8,
    rooms,
    output_path: partial.output_path,
    wall_thickness_exterior: partial.wall_thickness_exterior ?? 0.25,
    wall_thickness_interior: partial.wall_thickness_interior ?? 0.15,
    include_terrace: partial.include_terrace ?? true,
    terrace_depth: partial.terrace_depth ?? 2.0,
    style: partial.style ?? "linear",
  };
}
