// ─────────────────────────────────────────────────────────────
// Shared types for the AutoCAD House Plan MCP pipeline
// ─────────────────────────────────────────────────────────────

export type RoomType =
  | "bedroom"
  | "master_bedroom"
  | "bathroom"
  | "half_bath"
  | "living_room"
  | "dining_room"
  | "kitchen"
  | "living_dining"
  | "living_kitchen"
  | "hallway"
  | "study"
  | "terrace"
  | "garage";

export type StylePreference = "compact" | "linear" | "open";

export interface RoomSpec {
  type: RoomType;
  count: number;
  min_area?: number;   // m², overrides default minimums
  label?: string;      // Custom label override
}

export interface HouseSpec {
  lot_width: number;   // metres (X axis)
  lot_depth: number;   // metres (Y axis)
  rooms: RoomSpec[];
  output_path?: string;
  wall_thickness_exterior?: number;  // default 0.25
  wall_thickness_interior?: number;  // default 0.15
  include_terrace?: boolean;         // default true
  terrace_depth?: number;            // default 2.0
  style?: StylePreference;
}

export type Zone = "public" | "transit" | "private";

export interface PlacedRoom {
  id: string;
  label: string;
  type: RoomType;
  zone: Zone;
  x1: number;   // inner bounding box (after wall offset)
  y1: number;
  x2: number;
  y2: number;
  area: number; // m²
}

export type FacingWall = "N" | "S" | "E" | "W";

export interface DoorSpec {
  kind: "door";
  x: number;         // insertion point for block
  y: number;
  rotation: number;  // degrees
  width: number;     // metres
  blockPath: string;
  // The void cut in the wall (REGION to SUBTRACT)
  cutX1: number;
  cutY1: number;
  cutX2: number;
  cutY2: number;
}

export interface WindowSpec {
  kind: "window";
  x: number;
  y: number;
  rotation: number;  // degrees
  width: number;     // metres
  facing: FacingWall;
  blockPath: string;
  wallDepthCut: number; // how far the void extends through the wall (RULES.window_depth_cut)
  cutX1: number;
  cutY1: number;
  cutX2: number;
  cutY2: number;
}

export type Opening = DoorSpec | WindowSpec;

export interface Layout {
  lot_width: number;
  lot_depth: number;
  wall_ext: number;
  wall_int: number;
  include_terrace: boolean;
  terrace_depth: number;
  rooms: PlacedRoom[];
  doors: DoorSpec[];
  windows: WindowSpec[];
}
