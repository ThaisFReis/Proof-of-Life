import { describe, expect, test } from 'bun:test';
import {
  BOARD_H,
  BOARD_W,
  BLOCKED_TILES,
  canMove4,
  DOORS_OPEN,
  findExitInDirection,
  getCellPlan,
  getDoorExitsForRoom,
  getRoomCodeAt,
  isAssassinPassable,
  isBlockedTile,
  isHideTile,
  listDoorMarkers,
  pickHideTileWithin,
  pickHideTile,
  HIDE_TILES,
} from './floorplan';

describe('world/floorplan', () => {
  test('grid is 10x10 and has known room codes', () => {
    expect(BOARD_W).toBe(10);
    expect(BOARD_H).toBe(10);
    const c = getRoomCodeAt(0, 0);
    expect(typeof c).toBe('string');
    expect(c.length).toBe(1);
  });

  test('perimeter walls block leaving the board', () => {
    // Top edge
    for (let x = 0; x < BOARD_W; x++) {
      expect(getCellPlan(x, 0).walls.N).toBe(true);
    }
    // Left edge
    for (let y = 0; y < BOARD_H; y++) {
      expect(getCellPlan(0, y).walls.W).toBe(true);
    }
  });

  test('canMove4 is symmetric for adjacent tiles', () => {
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        if (x + 1 < BOARD_W) {
          expect(canMove4(x, y, x + 1, y)).toBe(canMove4(x + 1, y, x, y));
        }
        if (y + 1 < BOARD_H) {
          expect(canMove4(x, y, x, y + 1)).toBe(canMove4(x, y + 1, x, y));
        }
      }
    }
  });

  test('no diagonal movement', () => {
    expect(canMove4(4, 4, 5, 5)).toBe(false);
    expect(canMove4(4, 4, 3, 5)).toBe(false);
  });

  test('rooms have at least one doorway (map connectivity baseline)', () => {
    const exitsE = getDoorExitsForRoom('E');
    expect(exitsE.length).toBeGreaterThan(0);
  });

  test('can find a directional exit when available', () => {
    // From Living Room, east should lead to the hallway.
    const ex = findExitInDirection('L', 'E');
    expect(ex).not.toBeNull();
  });

  test('hide tiles exist and are blocked for assassin', () => {
    const t = pickHideTile('E', 0);
    expect(t).not.toBeNull();
    expect(isAssassinPassable(t!.x, t!.y)).toBe(false);
  });

  test('all configured hide tiles are recognized as hide tiles and blocked for assassin', () => {
    const codes = Object.keys(HIDE_TILES) as (keyof typeof HIDE_TILES)[];
    let count = 0;
    for (const code of codes) {
      for (const t of HIDE_TILES[code]) {
        count++;
        expect(isHideTile(t.x, t.y)).toBe(true);
        expect(isAssassinPassable(t.x, t.y)).toBe(false);
        // Data correctness: a hide tile should belong to the room list it is declared under.
        expect(getRoomCodeAt(t.x, t.y)).toBe(code);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  test('hide tiles are only selectable when within manhattan distance', () => {
    const near = pickHideTileWithin('E', 3, 9, 0, 2);
    expect(near).not.toBeNull();
    const far = pickHideTileWithin('E', 0, 0, 0, 2);
    expect(far).toBeNull();
  });

  test('blocked tiles are inaccessible and stop movement', () => {
    expect(BLOCKED_TILES.length).toBeGreaterThan(0);
    const b = BLOCKED_TILES[0];
    expect(isBlockedTile(b.x, b.y)).toBe(true);
    expect(isAssassinPassable(b.x, b.y)).toBe(false);
    // Adjacent move into blocked must be false.
    expect(canMove4(b.x, b.y - 1, b.x, b.y)).toBe(false);
  });

  test('stairs tiles are blocked (inaccessible)', () => {
    expect(isBlockedTile(5, 2)).toBe(true);
    expect(isBlockedTile(6, 2)).toBe(true);
    expect(isAssassinPassable(5, 2)).toBe(false);
    expect(isAssassinPassable(6, 2)).toBe(false);
  });

  test('door markers include both open and closed doors', () => {
    const doors = listDoorMarkers();
    expect(doors.find((d) => d.state === 'open')).toBeTruthy();
    expect(doors.find((d) => d.state === 'closed')).toBeTruthy();
  });

  test('required open doors exist (new layout)', () => {
    const has = (ax: number, ay: number, bx: number, by: number) =>
      DOORS_OPEN.some((d) => (d.ax === ax && d.ay === ay && d.bx === bx && d.by === by) || (d.ax === bx && d.ay === by && d.bx === ax && d.by === ay));

    expect(has(1, 2, 1, 3)).toBe(true); // G <-> L
    expect(has(2, 4, 2, 5)).toBe(true); // L <-> B (moved)
    expect(has(2, 3, 3, 3)).toBe(true); // L <-> H
    expect(has(2, 6, 3, 6)).toBe(true); // B <-> H
    expect(has(2, 7, 3, 7)).toBe(true); // B <-> E
    expect(has(8, 2, 8, 3)).toBe(true); // G <-> S
    expect(has(5, 3, 6, 3)).toBe(true); // S <-> H
    expect(has(7, 6, 7, 7)).toBe(true); // K <-> D
    expect(has(6, 8, 7, 8)).toBe(true); // K <-> H
    expect(has(6, 5, 7, 5)).toBe(true); // D <-> H
    expect(has(4, 6, 4, 7)).toBe(true); // explicit
  });
});
