import type { ChadCommand, SessionState } from '../model';
import { canMove4, getDoorExitsForRoom, getRoomCodeAt, isChadWalkable, pickHideTileWithin, ROOM_LEGEND, type RoomCode } from '../world/floorplan';

export type ChadCommandOption = Readonly<{
  cmd: ChadCommand;
  label: string;
}>;

const ROOM_TO_GO: Readonly<Record<RoomCode, ChadCommand | null>> = {
  G: 'GO_GARDEN',
  H: 'GO_HALLWAY',
  L: 'GO_LIVING',
  S: 'GO_STUDY',
  B: 'GO_LIBRARY',
  D: 'GO_DINING',
  K: 'GO_KITCHEN',
  E: 'GO_GRAND_HALL',
  W: null,
} as const;

const ROOM_LABEL_SHORT: Readonly<Record<RoomCode, string>> = {
  G: 'GARDEN',
  H: 'HALLWAY',
  L: 'LIVING',
  S: 'STUDY',
  B: 'LIBRARY',
  D: 'DINING',
  K: 'KITCHEN',
  E: 'HALL',
  W: 'SEALED',
} as const;

export function getAvailableChadCommands(session: SessionState): readonly ChadCommandOption[] {
  const x = typeof session.chad_x === 'number' ? session.chad_x : 5;
  const y = typeof session.chad_y === 'number' ? session.chad_y : 5;
  const room = getRoomCodeAt(x, y);

  const out: ChadCommandOption[] = [{ cmd: 'STAY', label: 'STAY' }];

  // HIDE is only available if there is any hide tile within Manhattan distance <= 2.
  const hideStreak = typeof session.chad_hide_streak === 'number' ? session.chad_hide_streak : 0;
  const canHide = hideStreak < 2 && !!pickHideTileWithin(room, x, y, session.turn ?? 0, 2);
  if (canHide) out.push({ cmd: 'HIDE', label: 'HIDE' });

  // Garden is large: allow walking within the garden so Chad can reposition between sub-areas.
  if (room === 'G') {
    const cand: ReadonlyArray<{ cmd: ChadCommand; label: string; nx: number; ny: number }> = [
      { cmd: 'WALK_N', label: 'WALK NORTH', nx: x, ny: y - 1 },
      { cmd: 'WALK_S', label: 'WALK SOUTH', nx: x, ny: y + 1 },
      { cmd: 'WALK_W', label: 'WALK WEST', nx: x - 1, ny: y },
      { cmd: 'WALK_E', label: 'WALK EAST', nx: x + 1, ny: y },
    ];
    for (const c of cand) {
      if (getRoomCodeAt(c.nx, c.ny) !== 'G') continue;
      if (!isChadWalkable(c.nx, c.ny)) continue;
      if (!canMove4(x, y, c.nx, c.ny)) continue;
      out.push({ cmd: c.cmd, label: c.label });
    }
  }

  const addGo = (to: RoomCode) => {
    const cmd = ROOM_TO_GO[to];
    if (!cmd) return;
    const label = ROOM_LABEL_SHORT[to] ?? ROOM_LEGEND[to].label.toUpperCase();
    if (out.some((o) => o.cmd === cmd)) return;
    out.push({ cmd, label });
  };

  // Garden subdivision rules (Oct 1998 cell-tower constraints / map coverage).
  if (room === 'G' && y >= 0 && y <= 2) {
    const inLeft = x >= 0 && x <= 3;
    const inRight = x >= 7 && x <= 9;
    const inTopMid = x >= 4 && x <= 6 && y >= 0 && y <= 1;

    if (inLeft) {
      addGo('L');
      return out;
    }
    if (inRight) {
      addGo('S');
      return out;
    }
    if (inTopMid) {
      addGo('L');
      addGo('S');
      addGo('H');
      return out;
    }
  }

  // Default: offer any adjacent rooms reachable by at least one doorway from this room.
  const exits = getDoorExitsForRoom(room);
  for (const e of exits) addGo(e.toRoom);
  return out;
}

export function isChadCommandAllowed(session: SessionState, cmd: ChadCommand): boolean {
  return getAvailableChadCommands(session).some((o) => o.cmd === cmd);
}
