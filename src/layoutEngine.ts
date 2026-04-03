// ─────────────────────────────────────────────────────────────
// Layout Engine: 3-strip zoning algorithm for residential plans
//
// Zone strategy (matches generate_house_8x10.lsp pattern):
//   LEFT STRIP  → PUBLIC  (living / kitchen / dining)
//   CENTER STRIP → TRANSIT (hallway / bathrooms)
//   RIGHT STRIP → PRIVATE (bedrooms / study)
//
// All coordinates are in metres. X grows right, Y grows up.
// The room coordinates are INNER boxes (wall voids to subtract).
// ─────────────────────────────────────────────────────────────
import type {
  HouseSpec,
  RoomSpec,
  RoomType,
  PlacedRoom,
  DoorSpec,
  WindowSpec,
  Layout,
  Zone,
} from "./types.js";

// ── Architecture rules constants (from architecture_rules.md) ─
const RULES = {
  bedroom_min_area: 8.0,
  master_bedroom_min_area: 11.0,
  bathroom_min_area: 3.5,
  hallway_min_width: 0.9,
  door_width: 0.9,              // exterior door opening
  interior_door_width: 0.8,    // interior door opening (puerta_08)
  window_width: 1.8,           // standard window cut (ventana_2m block scaled)
  wall_cut_margin: 0.10,       // margin beyond wall face for boolean cuts
  corridor_ratio_max: 0.10,
  aspect_ratio_max: 2.0,
};

type ZoneGroup = { zone: Zone; types: RoomType[] };
const ZONE_MAP: ZoneGroup[] = [
  { zone: "public",  types: ["living_room", "living_dining", "living_kitchen", "dining_room", "kitchen"] },
  { zone: "transit", types: ["hallway", "bathroom", "half_bath"] },
  { zone: "private", types: ["bedroom", "master_bedroom", "study", "garage"] },
];

function getZone(type: RoomType): Zone {
  for (const z of ZONE_MAP) {
    if (z.types.includes(type)) return z.zone;
  }
  return "private";
}

function getDefaultLabel(type: RoomType, index: number): string {
  const LABELS: Record<RoomType, string> = {
    bedroom: index > 0 ? `Bedroom ${index + 1}` : "Bedroom",
    master_bedroom: "Master Bedroom",
    bathroom: index > 0 ? `Bathroom ${index + 1}` : "Bathroom",
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
  return LABELS[type] ?? type;
}

// Expand RoomSpec[] into a flat list of individual rooms (count > 1 → multiple)
// Default minimum areas per room type (from architecture_rules.md)
const DEFAULT_MIN_AREAS: Partial<Record<RoomType, number>> = {
  bedroom:         8.0,
  master_bedroom: 11.0,
  bathroom:        3.5,
  half_bath:       2.0,
  living_room:    18.0,
  living_kitchen: 18.0,
  living_dining:  18.0,
  kitchen:         6.0,
  dining_room:     8.0,
  hallway:         3.0,
  study:           7.0,
};

function expandRooms(specs: RoomSpec[]): Array<{ type: RoomType; label: string; min_area?: number }> {
  const out: Array<{ type: RoomType; label: string; min_area?: number }> = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      out.push({
        type: spec.type,
        label: spec.label
          ? spec.count > 1 ? `${spec.label} ${i + 1}` : spec.label
          : getDefaultLabel(spec.type, i),
        // Prefer explicit min_area; fall back to architecture rules defaults
        min_area: spec.min_area ?? DEFAULT_MIN_AREAS[spec.type],
      });
    }
  }
  return out;
}

// ── Strip width calculation ────────────────────────────────────
// Computes strip widths that respect both aspect-ratio limits and minimum
// room areas from architecture_rules.md.
function computeStripWidths(
  lotW: number,
  lotD: number,
  wallExt: number,
  wallInt: number,
  publicRooms:  Array<{ type: RoomType; min_area?: number }>,
  transitRooms: Array<{ type: RoomType; min_area?: number }>,
  privateRooms: Array<{ type: RoomType; min_area?: number }>
): { pubW: number; tranW: number; privW: number } {
  const usable   = lotW - 2 * wallExt;
  const usableH  = lotD - 2 * wallExt;

  // Minimum width needed for a strip to satisfy the largest min_area room,
  // given that rooms are divided equally in height.
  function minStripWidth(rooms: Array<{ type: RoomType; min_area?: number }>): number {
    if (rooms.length === 0) return 0;
    const heightPerRoom = usableH / rooms.length;
    const maxMinArea = Math.max(...rooms.map(r => r.min_area ?? 0));
    // width = area / height_per_room, with a sensible floor
    const fromArea = maxMinArea > 0 ? maxMinArea / heightPerRoom : 0;
    return fromArea;
  }

  const minPub  = Math.max(3.5, minStripWidth(publicRooms));
  const minTran = Math.max(1.2 + (transitRooms.length > 2 ? 1.0 : 0), minStripWidth(transitRooms));
  const minPriv = Math.max(3.0, minStripWidth(privateRooms));

  // Proportional allocation on top of minimums
  const total = publicRooms.length + transitRooms.length + privateRooms.length || 1;
  const pubRatio  = Math.max(publicRooms.length  / total, 0.35);
  const tranRatio = Math.max(transitRooms.length / total, 0.15);
  // privRatio fills remainder — don't over-constrain

  let pubW  = Math.max(usable * pubRatio,  minPub);
  let tranW = Math.max(usable * tranRatio, minTran);

  // Cap transit strip — bathrooms/hallways rarely need > 2.2m width
  const MAX_TRANSIT = 2.2;
  tranW = Math.min(tranW, MAX_TRANSIT);

  // Give private the rest, at least its minimum
  let privW = Math.max(usable - pubW - tranW - 2 * wallInt, minPriv);

  // If total still exceeds usable, shrink public & private proportionally
  const allocated = pubW + tranW + privW + 2 * wallInt;
  if (allocated > usable + 0.001) {
    const excess = allocated - usable;
    const pubPriv = pubW + privW;
    pubW  -= excess * (pubW / pubPriv);
    privW -= excess * (privW / pubPriv);
    // Enforce floor minimums
    pubW  = Math.max(pubW, minPub);
    privW = Math.max(privW, minPriv);
  }

  return {
    pubW:  parseFloat(pubW.toFixed(3)),
    tranW: parseFloat(tranW.toFixed(3)),
    privW: parseFloat(privW.toFixed(3)),
  };
}

// ── Place rooms within a vertical strip ───────────────────────
function placeRoomsInStrip(
  rooms: Array<{ type: RoomType; label: string; min_area?: number }>,
  zone: Zone,
  x1: number,             // left edge of void space (inside inner wall)
  x2: number,             // right edge
  lotDepth: number,
  wallExt: number,
  wallInt: number,
  startId: number
): PlacedRoom[] {
  const placed: PlacedRoom[] = [];
  if (rooms.length === 0) return placed;

  const stripW = x2 - x1;
  const usableH = lotDepth - 2 * wallExt;

  // Divide height equally among rooms
  const heightPerRoom = usableH / rooms.length;

  let currentY = wallExt;
  let idCounter = startId;

  for (let idx = 0; idx < rooms.length; idx++) {
    const room = rooms[idx];
    const isLast = idx === rooms.length - 1;
    const rx1 = x1;
    const ry1 = currentY;
    const rx2 = x2;
    // Last room extends to north wall inner face (no wasted gap)
    const ry2 = isLast ? (lotDepth - wallExt) : (currentY + heightPerRoom - wallInt);

    const area = (rx2 - rx1) * (ry2 - ry1);

    // Aspect ratio check — swap orientation hint if too extreme
    const w = rx2 - rx1;
    const h = ry2 - ry1;
    if (h > 0 && w / h > RULES.aspect_ratio_max * 1.5) {
      // Too wide — warn but continue (layout engine can't fix without restructuring)
      console.error(`[layout] Warning: room ${room.label} has aspect ratio ${(w/h).toFixed(2)} > ${RULES.aspect_ratio_max}`);
    }

    placed.push({
      id: `room_${idCounter++}`,
      label: room.label,
      type: room.type,
      zone,
      x1: parseFloat(rx1.toFixed(3)),
      y1: parseFloat(ry1.toFixed(3)),
      x2: parseFloat(rx2.toFixed(3)),
      y2: parseFloat(ry2.toFixed(3)),
      area: parseFloat(area.toFixed(2)),
    });

    currentY += heightPerRoom;
  }

  return placed;
}

// ── Door placement ─────────────────────────────────────────────
// Place a door where two adjacent rooms share a wall
function placeDoor(
  fromRoom: PlacedRoom,
  toRoom: PlacedRoom,
  wallInt: number,
  blockPath: string,
  doorWidth: number = RULES.interior_door_width
): DoorSpec | null {
  // Shared vertical wall (fromRoom on left, toRoom on right)
  const sharedX = fromRoom.x2;
  if (Math.abs(toRoom.x1 - sharedX) < wallInt + 0.01) {
    const overlapY1 = Math.max(fromRoom.y1, toRoom.y1);
    const overlapY2 = Math.min(fromRoom.y2, toRoom.y2);
    if (overlapY2 - overlapY1 < doorWidth) return null;

    const midY = (overlapY1 + overlapY2) / 2;

    return {
      kind: "door",
      // Insert at wall LEFT face (fromRoom side), at bottom of door opening
      x: parseFloat(sharedX.toFixed(3)),
      y: parseFloat((midY - doorWidth / 2).toFixed(3)),
      rotation: 90,  // door sits in a vertical wall → block rotated 90°
      width: doorWidth,
      blockPath,
      // Cut spans from fromRoom.x2 to toRoom.x1 (exact wall extent)
      cutX1: parseFloat(sharedX.toFixed(3)),
      cutY1: parseFloat((midY - doorWidth / 2).toFixed(3)),
      cutX2: parseFloat(toRoom.x1.toFixed(3)),
      cutY2: parseFloat((midY + doorWidth / 2).toFixed(3)),
    };
  }

  // Shared horizontal wall (fromRoom below, toRoom above)
  const sharedY = fromRoom.y2;
  if (Math.abs(toRoom.y1 - sharedY) < wallInt + 0.01) {
    const overlapX1 = Math.max(fromRoom.x1, toRoom.x1);
    const overlapX2 = Math.min(fromRoom.x2, toRoom.x2);
    if (overlapX2 - overlapX1 < doorWidth) return null;

    const midX = (overlapX1 + overlapX2) / 2;

    return {
      kind: "door",
      // Insert at left of door opening, at wall TOP face (toRoom side)
      x: parseFloat((midX - doorWidth / 2).toFixed(3)),
      y: parseFloat(toRoom.y1.toFixed(3)),
      rotation: 0,  // door sits in a horizontal wall → block at 0°
      width: doorWidth,
      blockPath,
      // Cut spans from fromRoom.y2 to toRoom.y1 (exact wall extent)
      cutX1: parseFloat((midX - doorWidth / 2).toFixed(3)),
      cutY1: parseFloat(sharedY.toFixed(3)),
      cutX2: parseFloat((midX + doorWidth / 2).toFixed(3)),
      cutY2: parseFloat(toRoom.y1.toFixed(3)),
    };
  }

  return null;
}

// ── Exterior entry door ────────────────────────────────────────
function placeExteriorDoor(
  room: PlacedRoom,
  wallExt: number,
  blockPath: string
): DoorSpec {
  // Place on south wall of the public room, slightly left of center
  const midX = (room.x1 + room.x2) / 2;
  const entryX = midX - RULES.door_width / 2;
  const m = RULES.wall_cut_margin;

  return {
    kind: "door",
    x: parseFloat(entryX.toFixed(3)),
    y: 0,
    rotation: 0,
    width: RULES.door_width,
    blockPath,
    cutX1: parseFloat(entryX.toFixed(3)),
    cutY1: parseFloat((-m).toFixed(3)),
    cutX2: parseFloat((entryX + RULES.door_width).toFixed(3)),
    cutY2: parseFloat((wallExt + m).toFixed(3)),
  };
}

// ── Window placement ───────────────────────────────────────────
function placeWindowsForRoom(
  room: PlacedRoom,
  lotW: number,
  lotD: number,
  wallExt: number,
  blockPath: string
): WindowSpec[] {
  const windows: WindowSpec[] = [];
  const w = RULES.window_width;
  const m = RULES.wall_cut_margin;

  // ── North wall (top) — room.y2 touches inner face of north exterior wall
  if (Math.abs(room.y2 - (lotD - wallExt)) < 0.05) {
    const cx = (room.x1 + room.x2) / 2;
    const wx = cx - w / 2;
    if (wx >= room.x1 && wx + w <= room.x2) {
      windows.push({
        kind: "window",
        x: parseFloat(wx.toFixed(3)),
        y: parseFloat((lotD - wallExt).toFixed(3)),  // inner wall face
        rotation: 0, width: w, facing: "N", blockPath,
        wallDepthCut: wallExt + 2 * m,
        cutX1: parseFloat(wx.toFixed(3)),
        cutY1: parseFloat((lotD - wallExt - m).toFixed(3)),
        cutX2: parseFloat((wx + w).toFixed(3)),
        cutY2: parseFloat((lotD + m).toFixed(3)),
      });
      return windows; // one window per room is enough
    }
  }

  // ── South wall (bottom) — skip public rooms (entry door is there)
  if (Math.abs(room.y1 - wallExt) < 0.05 && room.zone !== "public") {
    const cx = (room.x1 + room.x2) / 2;
    const wx = cx - w / 2;
    if (wx >= room.x1 && wx + w <= room.x2) {
      windows.push({
        kind: "window",
        x: parseFloat(wx.toFixed(3)),
        y: 0,  // block at outer wall edge (same as reference)
        rotation: 0, width: w, facing: "S", blockPath,
        wallDepthCut: wallExt + 2 * m,
        cutX1: parseFloat(wx.toFixed(3)),
        cutY1: parseFloat((-m).toFixed(3)),
        cutX2: parseFloat((wx + w).toFixed(3)),
        cutY2: parseFloat((wallExt + m).toFixed(3)),
      });
      return windows;
    }
  }

  // ── East wall (right) — room.x2 touches inner face of east exterior wall
  if (Math.abs(room.x2 - (lotW - wallExt)) < 0.05) {
    const cy = (room.y1 + room.y2) / 2;
    const roomH = room.y2 - room.y1;
    const wh = Math.min(w, roomH * 0.6);
    const wy = cy - wh / 2;
    windows.push({
      kind: "window",
      x: parseFloat((lotW - wallExt).toFixed(3)),  // inner wall face
      y: parseFloat(wy.toFixed(3)),
      rotation: 90, width: wh, facing: "E", blockPath,
      wallDepthCut: wallExt + 2 * m,
      cutX1: parseFloat((lotW - wallExt - m).toFixed(3)),
      cutY1: parseFloat(wy.toFixed(3)),
      cutX2: parseFloat((lotW + m).toFixed(3)),
      cutY2: parseFloat((wy + wh).toFixed(3)),
    });
    return windows;
  }

  // ── West wall (left) — room.x1 touches inner face of west exterior wall
  if (Math.abs(room.x1 - wallExt) < 0.05) {
    const cy = (room.y1 + room.y2) / 2;
    const roomH = room.y2 - room.y1;
    const wh = Math.min(w, roomH * 0.6);
    const wy = cy - wh / 2;
    windows.push({
      kind: "window",
      x: 0,  // block at outer wall edge
      y: parseFloat(wy.toFixed(3)),
      rotation: 90, width: wh, facing: "W", blockPath,
      wallDepthCut: wallExt + 2 * m,
      cutX1: parseFloat((-m).toFixed(3)),
      cutY1: parseFloat(wy.toFixed(3)),
      cutX2: parseFloat((wallExt + m).toFixed(3)),
      cutY2: parseFloat((wy + wh).toFixed(3)),
    });
    return windows;
  }

  return windows;
}

// ── Terrace placed as a virtual room above the lot ─────────────
function placeTerrace(
  lotW: number,
  lotD: number,
  terraceDepth: number,
  wallExt: number
): PlacedRoom {
  return {
    id: "room_terrace",
    label: "Terrace",
    type: "terrace",
    zone: "public",
    x1: wallExt,
    y1: lotD + wallExt,
    x2: lotW - wallExt,
    y2: lotD + terraceDepth - wallExt,
    area: parseFloat(((lotW - 2 * wallExt) * (terraceDepth - 2 * wallExt)).toFixed(2)),
  };
}

// ── Validation ─────────────────────────────────────────────────
function validateLayout(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];

  for (const r of rooms) {
    if (r.type === "bedroom" && r.area < RULES.bedroom_min_area) {
      errors.push(`${r.label} area ${r.area.toFixed(1)}m² < minimum ${RULES.bedroom_min_area}m²`);
    }
    if (r.type === "master_bedroom" && r.area < RULES.master_bedroom_min_area) {
      errors.push(`${r.label} area ${r.area.toFixed(1)}m² < minimum ${RULES.master_bedroom_min_area}m²`);
    }
    if ((r.type === "bathroom" || r.type === "half_bath") && r.area < RULES.bathroom_min_area) {
      errors.push(`${r.label} area ${r.area.toFixed(1)}m² < minimum ${RULES.bathroom_min_area}m²`);
    }
    const w = r.x2 - r.x1;
    const h = r.y2 - r.y1;
    if (h > 0 && w / h > RULES.aspect_ratio_max) {
      errors.push(`${r.label} aspect ratio ${(w/h).toFixed(2)} > ${RULES.aspect_ratio_max} (too narrow)`);
    }
  }

  return errors;
}

// ── Public entry point ─────────────────────────────────────────
export interface LayoutResult {
  layout: Layout;
  warnings: string[];
}

export function generateLayout(spec: HouseSpec, blockRoot: string): LayoutResult {
  const warnings: string[] = [];

  const wallExt = spec.wall_thickness_exterior ?? 0.25;
  const wallInt = spec.wall_thickness_interior ?? 0.15;
  const lotW    = spec.lot_width;
  const lotD    = spec.lot_depth;

  const doorBlockPath         = `${blockRoot}/doors/puerta_09.dwg`.replace(/\\/g, "/");
  const interiorDoorBlockPath = `${blockRoot}/doors/puerta_08.dwg`.replace(/\\/g, "/");
  const windowBlockPath       = `${blockRoot}/windows/ventana_2m.dwg`.replace(/\\/g, "/");

  // Expand room specs into individual rooms, skip terraces (handled separately)
  const allRooms = expandRooms(spec.rooms.filter(r => r.type !== "terrace"));

  const publicRooms  = allRooms.filter(r => getZone(r.type) === "public");
  const transitRooms = allRooms.filter(r => getZone(r.type) === "transit");
  const privateRooms = allRooms.filter(r => getZone(r.type) === "private");

  // Ensure at least one public room
  if (publicRooms.length === 0) {
    publicRooms.push({ type: "living_kitchen", label: "Living / Kitchen" });
    warnings.push("No public room specified — added Living/Kitchen by default");
  }

  // Compute strip widths
  const { pubW, tranW, privW } = computeStripWidths(
    lotW, lotD, wallExt, wallInt,
    publicRooms,
    transitRooms,
    privateRooms
  );

  // Strip X boundaries (inner void edges)
  const pubX1  = wallExt;
  const pubX2  = wallExt + pubW;
  const tranX1 = pubX2 + wallInt;
  const tranX2 = tranX1 + tranW;
  const privX1 = tranX2 + wallInt;
  const privX2 = lotW - wallExt;

  // Place rooms
  let idCounter = 1;
  const placedPublic  = placeRoomsInStrip(publicRooms,  "public",  pubX1,  pubX2,  lotD, wallExt, wallInt, idCounter);
  idCounter += placedPublic.length;
  const placedTransit = placeRoomsInStrip(transitRooms, "transit", tranX1, tranX2, lotD, wallExt, wallInt, idCounter);
  idCounter += placedTransit.length;
  const placedPrivate = placeRoomsInStrip(privateRooms, "private", privX1, privX2, lotD, wallExt, wallInt, idCounter);

  let allPlacedRooms: PlacedRoom[] = [...placedPublic, ...placedTransit, ...placedPrivate];

  // Terrace
  const terraceDepth = spec.terrace_depth ?? 2.0;
  const includeTerrace = spec.include_terrace !== false;
  if (includeTerrace && terraceDepth > 0) {
    allPlacedRooms.push(placeTerrace(lotW, lotD, terraceDepth, wallExt));
  }

  // Validate
  const validationErrors = validateLayout(allPlacedRooms);
  warnings.push(...validationErrors);

  // ── Doors ──────────────────────────────────────────────────────
  const doors: DoorSpec[] = [];

  // Exterior entry in first public room
  if (placedPublic.length > 0) {
    doors.push(placeExteriorDoor(placedPublic[0], wallExt, doorBlockPath));
  }

  // Public ↔ Transit connections
  for (const pub of placedPublic) {
    for (const trans of placedTransit) {
      const d = placeDoor(pub, trans, wallInt, interiorDoorBlockPath, RULES.interior_door_width);
      if (d) { doors.push(d); break; }
    }
  }

  // Transit ↔ Private connections
  for (const priv of placedPrivate) {
    const bestTrans = placedTransit.find(t => {
      const overlapY1 = Math.max(t.y1, priv.y1);
      const overlapY2 = Math.min(t.y2, priv.y2);
      return overlapY2 - overlapY1 >= RULES.interior_door_width;
    });
    if (bestTrans) {
      const d = placeDoor(bestTrans, priv, wallInt, interiorDoorBlockPath, RULES.interior_door_width);
      if (d) doors.push(d);
    }
  }

  // Transit ↔ Terrace door (if terrace exists)
  if (includeTerrace && placedTransit.length > 0) {
    const terrace = allPlacedRooms.find(r => r.type === "terrace");
    if (terrace) {
      // Door on the north wall of the topmost transit room
      const topTrans = [...placedTransit].sort((a, b) => b.y2 - a.y2)[0];
      const midX = (topTrans.x1 + topTrans.x2) / 2;
      const dx = midX - RULES.interior_door_width / 2;
      const m = RULES.wall_cut_margin;
      doors.push({
        kind: "door",
        x: parseFloat(dx.toFixed(3)),
        y: parseFloat(lotD.toFixed(3)),
        rotation: 0,
        width: RULES.interior_door_width,
        blockPath: interiorDoorBlockPath,
        // Cut through north exterior wall + terrace south wall
        cutX1: parseFloat(dx.toFixed(3)),
        cutY1: parseFloat((lotD - wallExt - m).toFixed(3)),
        cutX2: parseFloat((dx + RULES.interior_door_width).toFixed(3)),
        cutY2: parseFloat((lotD + m).toFixed(3)),
      });
    }
  }

  // ── Windows ────────────────────────────────────────────────────
  const windows: WindowSpec[] = [];
  for (const room of allPlacedRooms) {
    if (room.type === "hallway" || room.type === "terrace") continue;
    const ws = placeWindowsForRoom(room, lotW, lotD, wallExt, windowBlockPath);
    windows.push(...ws);
  }

  return {
    layout: {
      lot_width: lotW,
      lot_depth: lotD,
      wall_ext: wallExt,
      wall_int: wallInt,
      include_terrace: includeTerrace,
      terrace_depth: terraceDepth,
      rooms: allPlacedRooms,
      doors,
      windows,
    },
    warnings,
  };
}
