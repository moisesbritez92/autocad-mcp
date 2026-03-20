// ── Architecture rules constants (from architecture_rules.md) ─
const RULES = {
    bedroom_min_area: 8.0,
    master_bedroom_min_area: 11.0,
    bathroom_min_area: 3.0,
    hallway_min_width: 0.9,
    door_width: 0.9, // standard door cut in wall
    window_width: 1.8, // standard window cut (ventana_2m block width ≈ 2m)
    window_depth_cut: 0.45, // how far window notch protrudes through wall
    door_depth_cut: 0.50, // door opening depth through wall
    corridor_ratio_max: 0.10,
    aspect_ratio_max: 2.0,
};
const ZONE_MAP = [
    { zone: "public", types: ["living_room", "living_dining", "living_kitchen", "dining_room", "kitchen"] },
    { zone: "transit", types: ["hallway", "bathroom", "half_bath"] },
    { zone: "private", types: ["bedroom", "master_bedroom", "study", "garage"] },
];
function getZone(type) {
    for (const z of ZONE_MAP) {
        if (z.types.includes(type))
            return z.zone;
    }
    return "private";
}
function getDefaultLabel(type, index) {
    const LABELS = {
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
const DEFAULT_MIN_AREAS = {
    bedroom: 8.0,
    master_bedroom: 11.0,
    bathroom: 3.0,
    half_bath: 2.0,
    living_room: 12.0,
    living_kitchen: 14.0,
    living_dining: 14.0,
    kitchen: 6.0,
    dining_room: 8.0,
    hallway: 3.0,
    study: 7.0,
};
function expandRooms(specs) {
    const out = [];
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
function computeStripWidths(lotW, lotD, wallExt, wallInt, publicRooms, transitRooms, privateRooms) {
    const usable = lotW - 2 * wallExt;
    const usableH = lotD - 2 * wallExt;
    // Minimum width needed for a strip to satisfy the largest min_area room,
    // given that rooms are divided equally in height.
    function minStripWidth(rooms) {
        if (rooms.length === 0)
            return 0;
        const heightPerRoom = usableH / rooms.length;
        const maxMinArea = Math.max(...rooms.map(r => r.min_area ?? 0));
        // width = area / height_per_room, with a sensible floor
        const fromArea = maxMinArea > 0 ? maxMinArea / heightPerRoom : 0;
        return fromArea;
    }
    const minPub = Math.max(3.5, minStripWidth(publicRooms));
    const minTran = Math.max(1.2 + (transitRooms.length > 2 ? 1.0 : 0), minStripWidth(transitRooms));
    const minPriv = Math.max(3.0, minStripWidth(privateRooms));
    // Proportional allocation on top of minimums
    const total = publicRooms.length + transitRooms.length + privateRooms.length || 1;
    const pubRatio = Math.max(publicRooms.length / total, 0.35);
    const tranRatio = Math.max(transitRooms.length / total, 0.15);
    // privRatio fills remainder — don't over-constrain
    let pubW = Math.max(usable * pubRatio, minPub);
    let tranW = Math.max(usable * tranRatio, minTran);
    // Give private the rest, at least its minimum
    let privW = Math.max(usable - pubW - tranW - 2 * wallInt, minPriv);
    // If total still exceeds usable, scale back proportionally
    const allocated = pubW + tranW + privW + 2 * wallInt;
    if (allocated > usable + 0.001) {
        // Try to shrink transit (bathrooms are flexible) first
        const excess = allocated - usable;
        const shrinkTran = Math.min(excess * 0.5, tranW - minTran);
        tranW -= Math.max(0, shrinkTran);
        const excess2 = pubW + tranW + privW + 2 * wallInt - usable;
        if (excess2 > 0.001) {
            // Last resort: scale all proportionally
            const scale = usable / (pubW + tranW + privW + 2 * wallInt);
            pubW *= scale;
            tranW *= scale;
            privW *= scale;
        }
    }
    return {
        pubW: parseFloat(pubW.toFixed(3)),
        tranW: parseFloat(tranW.toFixed(3)),
        privW: parseFloat(privW.toFixed(3)),
    };
}
// ── Place rooms within a vertical strip ───────────────────────
function placeRoomsInStrip(rooms, zone, x1, // left edge of void space (inside inner wall)
x2, // right edge
lotDepth, wallExt, wallInt, startId) {
    const placed = [];
    if (rooms.length === 0)
        return placed;
    const stripW = x2 - x1;
    const usableH = lotDepth - 2 * wallExt;
    // Divide height equally among rooms
    const heightPerRoom = usableH / rooms.length;
    let currentY = wallExt;
    let idCounter = startId;
    for (const room of rooms) {
        const rx1 = x1;
        const ry1 = currentY;
        const rx2 = x2;
        const ry2 = currentY + heightPerRoom - wallInt;
        const area = (rx2 - rx1) * (ry2 - ry1);
        // Aspect ratio check — swap orientation hint if too extreme
        const w = rx2 - rx1;
        const h = ry2 - ry1;
        if (h > 0 && w / h > RULES.aspect_ratio_max * 1.5) {
            // Too wide — warn but continue (layout engine can't fix without restructuring)
            console.error(`[layout] Warning: room ${room.label} has aspect ratio ${(w / h).toFixed(2)} > ${RULES.aspect_ratio_max}`);
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
function placeDoor(fromRoom, toRoom, wallInt, blockPath) {
    // Shared vertical wall (fromRoom on left, toRoom on right)
    const sharedX = fromRoom.x2;
    if (Math.abs(toRoom.x1 - sharedX) < wallInt + 0.01) {
        const overlapY1 = Math.max(fromRoom.y1, toRoom.y1);
        const overlapY2 = Math.min(fromRoom.y2, toRoom.y2);
        if (overlapY2 - overlapY1 < RULES.door_width)
            return null;
        const midY = (overlapY1 + overlapY2) / 2;
        const insertX = sharedX - 0.01;
        const insertY = midY - RULES.door_width / 2;
        return {
            kind: "door",
            x: parseFloat(insertX.toFixed(3)),
            y: parseFloat((midY - RULES.door_width / 2).toFixed(3)),
            rotation: 90, // door sits in a vertical wall → block must rotate 90° to align with wall
            width: RULES.door_width,
            blockPath,
            cutX1: parseFloat((sharedX - wallInt / 2 - 0.05).toFixed(3)),
            cutY1: parseFloat((midY - RULES.door_width / 2).toFixed(3)),
            cutX2: parseFloat((sharedX + wallInt / 2 + 0.05).toFixed(3)),
            cutY2: parseFloat((midY + RULES.door_width / 2).toFixed(3)),
        };
    }
    // Shared horizontal wall (fromRoom below, toRoom above)
    const sharedY = fromRoom.y2;
    if (Math.abs(toRoom.y1 - sharedY) < wallInt + 0.01) {
        const overlapX1 = Math.max(fromRoom.x1, toRoom.x1);
        const overlapX2 = Math.min(fromRoom.x2, toRoom.x2);
        if (overlapX2 - overlapX1 < RULES.door_width)
            return null;
        const midX = (overlapX1 + overlapX2) / 2;
        return {
            kind: "door",
            x: parseFloat((midX - RULES.door_width / 2).toFixed(3)),
            y: parseFloat((sharedY - 0.01).toFixed(3)),
            rotation: 0, // door sits in a horizontal wall → block at 0° (long axis along X)
            width: RULES.door_width,
            blockPath,
            cutX1: parseFloat((midX - RULES.door_width / 2).toFixed(3)),
            cutY1: parseFloat((sharedY - wallInt / 2 - 0.05).toFixed(3)),
            cutX2: parseFloat((midX + RULES.door_width / 2).toFixed(3)),
            cutY2: parseFloat((sharedY + wallInt / 2 + 0.05).toFixed(3)),
        };
    }
    return null;
}
// ── Exterior entry door ────────────────────────────────────────
function placeExteriorDoor(room, wallExt, blockPath) {
    // Place on south wall of the public room
    const midX = (room.x1 + room.x2) / 2;
    const entryX = midX - RULES.door_width / 2 + 0.3;
    return {
        kind: "door",
        x: parseFloat(entryX.toFixed(3)),
        y: 0,
        rotation: 0,
        width: RULES.door_width,
        blockPath,
        cutX1: parseFloat(entryX.toFixed(3)),
        cutY1: parseFloat((-0.1).toFixed(3)),
        cutX2: parseFloat((entryX + RULES.door_width).toFixed(3)),
        cutY2: parseFloat((wallExt + 0.1).toFixed(3)),
    };
}
// ── Window placement ───────────────────────────────────────────
function placeWindowsForRoom(room, lotW, lotD, wallExt, blockPath) {
    const windows = [];
    const w = RULES.window_width;
    const d = RULES.window_depth_cut;
    // North wall (top)
    if (Math.abs(room.y2 - (lotD - wallExt)) < 0.05) {
        const cx = (room.x1 + room.x2) / 2;
        const wx = cx - w / 2;
        if (wx >= room.x1 && wx + w <= room.x2) {
            windows.push({
                kind: "window", x: parseFloat(wx.toFixed(3)), y: parseFloat((lotD - wallExt / 2).toFixed(3)),
                rotation: 0, width: w, facing: "N", blockPath, wallDepthCut: d,
                cutX1: parseFloat(wx.toFixed(3)), cutY1: parseFloat((lotD - wallExt - d).toFixed(3)),
                cutX2: parseFloat((wx + w).toFixed(3)), cutY2: parseFloat((lotD + d).toFixed(3)),
            });
            return windows; // one window per room wall is enough
        }
    }
    // South wall (bottom) — skip if it's exterior entry wall
    if (Math.abs(room.y1 - wallExt) < 0.05 && room.zone !== "public") {
        const cx = (room.x1 + room.x2) / 2;
        const wx = cx - w / 2;
        if (wx >= room.x1 && wx + w <= room.x2) {
            windows.push({
                kind: "window", x: parseFloat(wx.toFixed(3)), y: 0,
                rotation: 0, width: w, facing: "S", blockPath, wallDepthCut: d,
                cutX1: parseFloat(wx.toFixed(3)), cutY1: parseFloat((-d).toFixed(3)),
                cutX2: parseFloat((wx + w).toFixed(3)), cutY2: parseFloat((wallExt + d).toFixed(3)),
            });
            return windows;
        }
    }
    // East wall (right)
    if (Math.abs(room.x2 - (lotW - wallExt)) < 0.05) {
        const cy = (room.y1 + room.y2) / 2;
        const roomH = room.y2 - room.y1;
        const wy = cy - Math.min(w, roomH * 0.6) / 2;
        const wh = Math.min(w, roomH * 0.6);
        windows.push({
            kind: "window", x: parseFloat((lotW - wallExt / 2).toFixed(3)), y: parseFloat(wy.toFixed(3)),
            rotation: 90, width: wh, facing: "E", blockPath, wallDepthCut: d,
            cutX1: parseFloat((lotW - wallExt - d).toFixed(3)), cutY1: parseFloat(wy.toFixed(3)),
            cutX2: parseFloat((lotW + d).toFixed(3)), cutY2: parseFloat((wy + wh).toFixed(3)),
        });
    }
    return windows;
}
// ── Terrace placed as a virtual room above the lot ─────────────
function placeTerrace(lotW, lotD, terraceDepth, wallExt) {
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
function validateLayout(rooms) {
    const errors = [];
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
            errors.push(`${r.label} aspect ratio ${(w / h).toFixed(2)} > ${RULES.aspect_ratio_max} (too narrow)`);
        }
    }
    return errors;
}
export function generateLayout(spec, blockRoot) {
    const warnings = [];
    const wallExt = spec.wall_thickness_exterior ?? 0.25;
    const wallInt = spec.wall_thickness_interior ?? 0.15;
    const lotW = spec.lot_width;
    const lotD = spec.lot_depth;
    const doorBlockPath = `${blockRoot}/doors/puerta_09.dwg`.replace(/\\/g, "/");
    const windowBlockPath = `${blockRoot}/windows/ventana_2m.dwg`.replace(/\\/g, "/");
    // Expand room specs into individual rooms, skip terraces (handled separately)
    const allRooms = expandRooms(spec.rooms.filter(r => r.type !== "terrace"));
    const publicRooms = allRooms.filter(r => getZone(r.type) === "public");
    const transitRooms = allRooms.filter(r => getZone(r.type) === "transit");
    const privateRooms = allRooms.filter(r => getZone(r.type) === "private");
    // Ensure at least one public room
    if (publicRooms.length === 0) {
        publicRooms.push({ type: "living_kitchen", label: "Living / Kitchen" });
        warnings.push("No public room specified — added Living/Kitchen by default");
    }
    // Compute strip widths
    const { pubW, tranW, privW } = computeStripWidths(lotW, lotD, wallExt, wallInt, publicRooms, transitRooms, privateRooms);
    // Strip X boundaries (inner void edges)
    const pubX1 = wallExt;
    const pubX2 = wallExt + pubW;
    const tranX1 = pubX2 + wallInt;
    const tranX2 = tranX1 + tranW;
    const privX1 = tranX2 + wallInt;
    const privX2 = lotW - wallExt;
    // Place rooms
    let idCounter = 1;
    const placedPublic = placeRoomsInStrip(publicRooms, "public", pubX1, pubX2, lotD, wallExt, wallInt, idCounter);
    idCounter += placedPublic.length;
    const placedTransit = placeRoomsInStrip(transitRooms, "transit", tranX1, tranX2, lotD, wallExt, wallInt, idCounter);
    idCounter += placedTransit.length;
    const placedPrivate = placeRoomsInStrip(privateRooms, "private", privX1, privX2, lotD, wallExt, wallInt, idCounter);
    let allPlacedRooms = [...placedPublic, ...placedTransit, ...placedPrivate];
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
    const doors = [];
    // Exterior entry in first public room
    if (placedPublic.length > 0) {
        doors.push(placeExteriorDoor(placedPublic[0], wallExt, doorBlockPath));
    }
    // Public ↔ Transit connections
    for (const pub of placedPublic) {
        for (const trans of placedTransit) {
            const d = placeDoor(pub, trans, wallInt, doorBlockPath);
            if (d) {
                doors.push(d);
                break;
            }
        }
    }
    // Transit ↔ Private connections
    for (const priv of placedPrivate) {
        const bestTrans = placedTransit.find(t => {
            const overlapY1 = Math.max(t.y1, priv.y1);
            const overlapY2 = Math.min(t.y2, priv.y2);
            return overlapY2 - overlapY1 >= RULES.door_width;
        });
        if (bestTrans) {
            const d = placeDoor(bestTrans, priv, wallInt, doorBlockPath);
            if (d)
                doors.push(d);
        }
    }
    // Transit ↔ Terrace door (if terrace exists)
    if (includeTerrace && placedTransit.length > 0) {
        const terrace = allPlacedRooms.find(r => r.type === "terrace");
        if (terrace) {
            // Door on the north wall of the topmost transit room (horizontal wall → rotation=0)
            const topTrans = [...placedTransit].sort((a, b) => b.y2 - a.y2)[0];
            const midX = (topTrans.x1 + topTrans.x2) / 2;
            const dx = midX - RULES.door_width / 2;
            doors.push({
                kind: "door",
                x: parseFloat(dx.toFixed(3)),
                y: parseFloat(lotD.toFixed(3)),
                rotation: 0, // horizontal wall (runs along X) → door block at 0°
                width: RULES.door_width,
                blockPath: doorBlockPath,
                cutX1: parseFloat(dx.toFixed(3)),
                cutY1: parseFloat((lotD - 0.1).toFixed(3)),
                cutX2: parseFloat((dx + RULES.door_width).toFixed(3)),
                cutY2: parseFloat((lotD + terraceDepth * 0.3).toFixed(3)),
            });
        }
    }
    // ── Windows ────────────────────────────────────────────────────
    const windows = [];
    for (const room of allPlacedRooms) {
        if (room.type === "hallway" || room.type === "terrace")
            continue;
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
