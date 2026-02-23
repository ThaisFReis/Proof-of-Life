export type Dir = 'N' | 'E' | 'S' | 'W';

export type WallMask = Readonly<{ N: boolean; E: boolean; S: boolean; W: boolean }>;

export type CellPlan = Readonly<{
  room: RoomCode;
  walls: WallMask;
}>;

export type RoomCode = 'G' | 'H' | 'L' | 'S' | 'B' | 'D' | 'E' | 'K' | 'W';

export type RoomMeta = Readonly<{
  code: RoomCode;
  label: string;
  fill: string;
  flavor: string;
}>;

export const ROOM_LEGEND: Readonly<Record<RoomCode, RoomMeta>> = {
  G: {
    code: 'G',
    label: 'Indoor Garden',
    fill: 'rgba(0, 255, 170, 0.03)',
    flavor: 'Broken glass ceiling. Rain is coming in.',
  },
  H: {
    code: 'H',
    label: 'Hallway',
    fill: 'rgba(184, 255, 220, 0.04)',
    flavor: 'Narrow corridor. Wallpaper peeling like dead skin.',
  },
  L: {
    code: 'L',
    label: 'Living Room',
    fill: 'rgba(255, 210, 110, 0.035)',
    flavor: "Torn sofas. There's an unlit fireplace.",
  },
  S: {
    code: 'S',
    label: 'Study',
    fill: 'rgba(140, 180, 255, 0.03)',
    flavor: 'A desk lamp clicks, but no light comes on.',
  },
  B: {
    code: 'B',
    label: 'Library Wing',
    fill: 'rgba(210, 160, 255, 0.025)',
    flavor: 'Tall shelves. Dust. The floor creaks here.',
  },
  D: {
    code: 'D',
    label: 'Dining Room',
    fill: 'rgba(255, 140, 140, 0.025)',
    flavor: 'A long table. Silverware laid out like teeth.',
  },
  E: {
    code: 'E',
    label: 'Grand Hall',
    fill: 'rgba(255, 210, 110, 0.03)',
    flavor: 'Main door locked. Cold marble underfoot.',
  },
  K: {
    code: 'K',
    label: 'Industrial Kitchen',
    fill: 'rgba(255, 255, 255, 0.02)',
    flavor: 'Rotten meat smell. Rusty knives on the counter.',
  },
  W: {
    code: 'W',
    label: 'Winter Garden (Sealed)',
    fill: 'rgba(120, 200, 255, 0.02)',
    flavor: 'Frosted glass. Condensation. The door is welded shut.',
  },
} as const;

export type HideTile = Readonly<{ x: number; y: number; label: string }>;

// These tiles are “tight spaces” (closets/pantries) that Chad can hide in.
// Assassin cannot step onto these tiles.
export const HIDE_TILES: Readonly<Record<RoomCode, readonly HideTile[]>> = {
  G: [
    { x: 1, y: 1, label: 'behind a stone planter' },
    { x: 8, y: 0, label: 'under a toppled bench' },
  ],
  // Keep hallway hide tiles inside actual hallway cells (room code 'H').
  H: [{ x: 5, y: 6, label: 'behind a torn curtain' }],
  L: [
    // Keep hide tiles away from doorway tiles (x=2,y=3/4) so exits remain usable.
    { x: 0, y: 3, label: 'inside the fireplace' },
    { x: 1, y: 4, label: 'behind the sofa' },
  ],
  S: [
    { x: 9, y: 3, label: 'inside a wardrobe' },
    { x: 7, y: 4, label: 'under the desk' },
  ],
  B: [
    { x: 0, y: 6, label: 'between shelves' },
    { x: 2, y: 8, label: 'inside a reading nook' },
  ],
  D: [
    { x: 9, y: 6, label: 'under the tablecloth' },
    { x: 7, y: 5, label: 'inside a cabinet' },
  ],
  E: [
    { x: 3, y: 9, label: 'inside the coat closet' },
    { x: 5, y: 8, label: 'beneath the staircase' },
  ],
  K: [
    { x: 8, y: 7, label: 'inside the pantry' },
    { x: 9, y: 9, label: 'under a prep table' },
  ],
  W: [],
} as const;

// Floorplan checksum: 09d0c48a (auto-generated, do not edit)
// Floorplan checksum: 9e73b691 (auto-generated, do not edit)
export const BOARD_W = 10;
export const BOARD_H = 10;

// A “mansion-ish” layout: rooms are contiguous blobs and walls are auto-generated at boundaries.
// Legend:
//   G Garden, H Hallway, L Living, S Study, B Library, D Dining, E Entrance/Grand Hall, K Kitchen, W Winter Garden
export const ROOM_GRID: readonly string[] = [
  'GGGGGGGGGG',
  'GGGGGGGGGG',
  // Keep the garden contiguous across y=2 so Chad can reposition between sections.
  // Hallway access from the garden is provided by an explicit door at (4,2)<->(4,3).
  'GGGGGGGGGG',
  'LLLHHHSSSS',
  'LLLHWHSSSS',
  // Make (6,5) hallway: x=6 is 'H'
  'BBBHWHHDDD',
  // Make (6,6) hallway: x=6 is 'H'
  'BBBHHHHDDD',
  'BBBEEEHKKK',
  'BBBEEEHKKK',
  'HHHEEEHKKK',
] as const;

type DoorEdge = Readonly<{ ax: number; ay: number; bx: number; by: number }>;

// Doors “punch through” boundary walls to keep the map connected and corridor-like.
export const DOORS_OPEN: readonly DoorEdge[] = [
  // Garden <-> Hallway (mid-garden passage)
  { ax: 4, ay: 2, bx: 4, by: 3 },
  // Garden <-> Living Room (single door)
  { ax: 1, ay: 2, bx: 1, by: 3 },
  // Living Room <-> Library (single door) (moved)
  { ax: 2, ay: 4, bx: 2, by: 5 },
  // Living Room <-> Hallway (single door)
  { ax: 2, ay: 3, bx: 3, by: 3 },
  // Library <-> Hallway (single door)
  { ax: 2, ay: 6, bx: 3, by: 6 },
  // Library <-> Grand Hall (single door)
  { ax: 2, ay: 7, bx: 3, by: 7 },
  // Garden <-> Study (single door)
  { ax: 8, ay: 2, bx: 8, by: 3 },
  // Study <-> Hallway (single door)
  { ax: 5, ay: 3, bx: 6, by: 3 },
  // Kitchen <-> Dining (single door)
  { ax: 7, ay: 6, bx: 7, by: 7 },
  // Kitchen <-> Hallway (single door)
  { ax: 6, ay: 8, bx: 7, by: 8 },
  // Dining <-> Hallway (single door)
  { ax: 6, ay: 5, bx: 7, by: 5 },
  // Explicit doors by coordinate (as requested)
  { ax: 4, ay: 6, bx: 4, by: 7 },
] as const;

// Closed doors are rendered, but still blocked by walls (they do not remove walls in the plan).
export const DOORS_CLOSED: readonly DoorEdge[] = [
  // Sealed winter garden glass doors (inaccessible area)
  { ax: 4, ay: 3, bx: 4, by: 4 },
  { ax: 4, ay: 5, bx: 4, by: 6 },
] as const;

export type MapLabel = Readonly<{
  code: RoomCode;
  label: string;
  x: number; // grid col start (0-index)
  y: number; // grid row start (0-index)
  w: number; // columns
  h: number; // rows
}>;

export const MAP_LABELS: readonly MapLabel[] = [
  { code: 'G', label: 'INDOOR GARDEN', x: 0, y: 0, w: 10, h: 3 },
  { code: 'L', label: 'LIVING', x: 0, y: 3, w: 3, h: 2 },
  { code: 'S', label: 'STUDY', x: 6, y: 3, w: 4, h: 2 },
  { code: 'B', label: 'LIBRARY', x: 0, y: 5, w: 3, h: 4 },
  { code: 'D', label: 'DINING', x: 6, y: 5, w: 4, h: 2 },
  { code: 'E', label: 'GRAND HALL', x: 3, y: 7, w: 3, h: 3 },
  { code: 'K', label: 'KITCHEN', x: 7, y: 7, w: 3, h: 3 },
  { code: 'W', label: 'WINTER GDN', x: 4, y: 4, w: 1, h: 2 },
];

export function getRoomCodeAt(x: number, y: number): RoomCode {
  if (x < 0 || y < 0 || x >= BOARD_W || y >= BOARD_H) return 'H';
  const row = ROOM_GRID[y];
  const c = row?.[x] as RoomCode | undefined;
  return c ?? 'H';
}

function mkMask(): { N: boolean; E: boolean; S: boolean; W: boolean } {
  return { N: false, E: false, S: false, W: false };
}

function addWall(plans: { room: RoomCode; walls: ReturnType<typeof mkMask> }[][], x: number, y: number, dir: Dir) {
  const c = plans[y]?.[x];
  if (!c) return;
  c.walls[dir] = true;
  const nx = dir === 'E' ? x + 1 : dir === 'W' ? x - 1 : x;
  const ny = dir === 'S' ? y + 1 : dir === 'N' ? y - 1 : y;
  const odir: Dir = dir === 'N' ? 'S' : dir === 'S' ? 'N' : dir === 'E' ? 'W' : 'E';
  const n = plans[ny]?.[nx];
  if (n) n.walls[odir] = true;
}

function removeWall(plans: { room: RoomCode; walls: ReturnType<typeof mkMask> }[][], ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  const dir: Dir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
  const a = plans[ay]?.[ax];
  const b = plans[by]?.[bx];
  if (!a || !b) return;
  a.walls[dir] = false;
  const odir: Dir = dir === 'N' ? 'S' : dir === 'S' ? 'N' : dir === 'E' ? 'W' : 'E';
  b.walls[odir] = false;
}

function build(): CellPlan[][] {
  const plans: { room: RoomCode; walls: ReturnType<typeof mkMask> }[][] = [];
  for (let y = 0; y < BOARD_H; y++) {
    const row: { room: RoomCode; walls: ReturnType<typeof mkMask> }[] = [];
    for (let x = 0; x < BOARD_W; x++) row.push({ room: getRoomCodeAt(x, y), walls: mkMask() });
    plans.push(row);
  }

  // Perimeter walls.
  for (let x = 0; x < BOARD_W; x++) {
    addWall(plans, x, 0, 'N');
    addWall(plans, x, BOARD_H - 1, 'S');
  }
  for (let y = 0; y < BOARD_H; y++) {
    addWall(plans, 0, y, 'W');
    addWall(plans, BOARD_W - 1, y, 'E');
  }

  // Boundary walls between differing rooms.
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const here = plans[y][x].room;
      if (x + 1 < BOARD_W && plans[y][x + 1].room !== here) addWall(plans, x, y, 'E');
      if (y + 1 < BOARD_H && plans[y + 1][x].room !== here) addWall(plans, x, y, 'S');
    }
  }

  // Doors punch through some boundary walls.
  for (const d of DOORS_OPEN) removeWall(plans, d.ax, d.ay, d.bx, d.by);

  return plans.map((r) =>
    r.map((c) => ({
      room: c.room,
      walls: { N: c.walls.N, E: c.walls.E, S: c.walls.S, W: c.walls.W },
    }))
  );
}

const FLOORPLAN = build();

export function getCellPlan(x: number, y: number): CellPlan {
  const row = FLOORPLAN[y];
  const cell = row?.[x];
  if (!cell) {
    return { room: 'H', walls: { N: true, E: true, S: true, W: true } };
  }
  return cell;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < BOARD_W && y < BOARD_H;
}

export function canMove4(ax: number, ay: number, bx: number, by: number): boolean {
  if (!inBounds(ax, ay) || !inBounds(bx, by)) return false;
  if (isBlockedTile(ax, ay) || isBlockedTile(bx, by)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false; // no diagonal / no teleport
  const a = getCellPlan(ax, ay);
  if (dx === 1) return !a.walls.E;
  if (dx === -1) return !a.walls.W;
  if (dy === 1) return !a.walls.S;
  return !a.walls.N;
}

export function getRoomMetaAt(x: number, y: number): RoomMeta {
  const code = getRoomCodeAt(x, y);
  return ROOM_LEGEND[code];
}

export function pickHideSpot(code: RoomCode, seed: number): string {
  const list = HIDE_TILES[code];
  if (!list.length) return 'somewhere dark';
  const idx = Math.abs(seed) % list.length;
  return list[idx].label;
}

export function pickHideTile(code: RoomCode, seed: number): HideTile | null {
  const list = HIDE_TILES[code];
  if (!list.length) return null;
  const idx = Math.abs(seed) % list.length;
  return list[idx];
}

export function pickHideTileWithin(
  code: RoomCode,
  fromX: number,
  fromY: number,
  seed: number,
  maxManhattan: number
): HideTile | null {
  const list = HIDE_TILES[code];
  if (!list.length) return null;
  const eligible = list.filter((t) => Math.abs(t.x - fromX) + Math.abs(t.y - fromY) <= maxManhattan);
  if (!eligible.length) return null;
  const idx = Math.abs(seed) % eligible.length;
  return eligible[idx];
}

export function isHideTile(x: number, y: number): boolean {
  // Treat hide tiles as absolute coordinates, regardless of the current room grid.
  // This prevents the assassin from ever stepping into a declared hide space even if the layout changes.
  const codes = Object.keys(HIDE_TILES) as RoomCode[];
  for (const code of codes) {
    const list = HIDE_TILES[code];
    for (const t of list) if (t.x === x && t.y === y) return true;
  }
  return false;
}

export type BlockedTile = Readonly<{ x: number; y: number; label: string }>;

// Inaccessible tiles: neither Chad nor assassin can enter.
export const BLOCKED_TILES: readonly BlockedTile[] = [
  { x: 4, y: 4, label: 'Winter Garden (sealed)' },
  { x: 4, y: 5, label: 'Winter Garden (sealed)' },
  { x: 5, y: 2, label: 'Stairs up (sealed)' },
  { x: 6, y: 2, label: 'Stairs up (sealed)' },
  { x: 0, y: 9, label: 'Balcony / railing' },
  { x: 1, y: 9, label: 'Balcony / railing' },
  { x: 2, y: 9, label: 'Balcony / railing' },
] as const;

export function isBlockedTile(x: number, y: number): boolean {
  for (const t of BLOCKED_TILES) if (t.x === x && t.y === y) return true;
  return false;
}

export function isAssassinPassable(x: number, y: number): boolean {
  return inBounds(x, y) && !isBlockedTile(x, y) && !isHideTile(x, y);
}

export function isChadSpawnable(x: number, y: number): boolean {
  return inBounds(x, y) && !isBlockedTile(x, y) && !isHideTile(x, y);
}

export function isChadWalkable(x: number, y: number): boolean {
  return inBounds(x, y) && !isBlockedTile(x, y) && !isHideTile(x, y);
}

export function getDoorExitsForRoom(code: RoomCode): readonly { fromX: number; fromY: number; toX: number; toY: number; dir: Dir; toRoom: RoomCode }[] {
  const out: { fromX: number; fromY: number; toX: number; toY: number; dir: Dir; toRoom: RoomCode }[] = [];
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (getRoomCodeAt(x, y) !== code) continue;
      const cand: { nx: number; ny: number; dir: Dir }[] = [
        { nx: x, ny: y - 1, dir: 'N' },
        { nx: x, ny: y + 1, dir: 'S' },
        { nx: x - 1, ny: y, dir: 'W' },
        { nx: x + 1, ny: y, dir: 'E' },
      ];
      for (const c of cand) {
        if (!inBounds(c.nx, c.ny)) continue;
        const other = getRoomCodeAt(c.nx, c.ny);
        if (other === code) continue;
        if (!canMove4(x, y, c.nx, c.ny)) continue;
        if (!isChadWalkable(c.nx, c.ny)) continue;
        out.push({ fromX: x, fromY: y, toX: c.nx, toY: c.ny, dir: c.dir, toRoom: other });
      }
    }
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir) || a.fromY - b.fromY || a.fromX - b.fromX || a.toY - b.toY || a.toX - b.toX);
  return out;
}

export function findExitInDirection(code: RoomCode, dir: Dir): { toX: number; toY: number; toRoom: RoomCode } | null {
  const exits = getDoorExitsForRoom(code).filter((e) => e.dir === dir);
  if (!exits.length) return null;
  const e = exits[0];
  return { toX: e.toX, toY: e.toY, toRoom: e.toRoom };
}

export function findAnyExitToRoom(from: RoomCode, to: RoomCode): { toX: number; toY: number; toRoom: RoomCode } | null {
  const exits = getDoorExitsForRoom(from).filter((e) => e.toRoom === to);
  if (!exits.length) return null;
  const e = exits[0];
  return { toX: e.toX, toY: e.toY, toRoom: e.toRoom };
}

export type DoorState = 'open' | 'closed';
export type DoorMarker = Readonly<{ x: number; y: number; dir: 'E' | 'S'; state: DoorState }>;

function normalizeEdge(e: DoorEdge): { x: number; y: number; dir: 'E' | 'S' } | null {
  const dx = e.bx - e.ax;
  const dy = e.by - e.ay;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  if (dx === 1) return { x: e.ax, y: e.ay, dir: 'E' };
  if (dx === -1) return { x: e.bx, y: e.by, dir: 'E' };
  if (dy === 1) return { x: e.ax, y: e.ay, dir: 'S' };
  return { x: e.bx, y: e.by, dir: 'S' };
}

export function listDoorMarkers(): readonly DoorMarker[] {
  const out: DoorMarker[] = [];
  for (const e of DOORS_OPEN) {
    const n = normalizeEdge(e);
    if (!n) continue;
    out.push({ ...n, state: 'open' });
  }
  for (const e of DOORS_CLOSED) {
    const n = normalizeEdge(e);
    if (!n) continue;
    out.push({ ...n, state: 'closed' });
  }
  out.sort((a, b) => a.state.localeCompare(b.state) || a.dir.localeCompare(b.dir) || a.y - b.y || a.x - b.x);
  return out;
}
