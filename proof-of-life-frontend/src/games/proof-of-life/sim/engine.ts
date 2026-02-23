import type { ChadCommand, SessionState, TowerId } from '../model';
import { formatPowerMeter } from '../terminal/powerMeter';
import {
  canMove4,
  findAnyExitToRoom,
  getRoomCodeAt,
  isAssassinPassable,
  isChadWalkable,
  isHideTile,
  pickHideSpot,
  pickHideTileWithin,
  ROOM_LEGEND,
} from '../world/floorplan';
import { getRoomDescription } from '../world/zones';

export type Coord = Readonly<{ x: number; y: number }>;

export type SecretState = {
  assassin: Coord;
  // Salt used by Noir circuits (Poseidon2 commitment over x,y,salt).
  // Frontend does not compute the commitment; the prover returns it as a public field.
  salt: number;
  // Not used for real ZK yet; tracked to match the mental model.
  commitment: string;
  // 32-byte hex string (0x...) suitable for on-chain `commit_location`.
  commitmentHex: string;
  // Assassin AI target (delayed). When Chad hides, this does NOT update, enabling misdirection.
  last_known_chad: Coord;
  // Visible Chad positions, used to apply a 2-turn delay to last_known_chad.
  seen_chad: Coord[];
};

export type SimConfig = {
  gridW: number;
  gridH: number;
  chadDefault: Coord;
  towers: Record<TowerId, Coord>;
};

export type AssassinMoveTrace = {
  // Ordered list of assassin coordinates visited this turn (each step is a 4-neighbor move).
  // Does not include the starting coordinate.
  path: Coord[];
  from: Coord;
  to: Coord;
};

export type AssassinTurnPrepared = {
  session: SessionState;
  secret: SecretState;
  from: Coord;
  target: Coord;
  chad: Coord;
  chadHidden: boolean;
  maxSteps: number;
  mustMove: boolean;
};

export type AssassinPathValidation = {
  ok: boolean;
  reason?: string;
  maxSteps: number;
  mustMove: boolean;
};

export const DEFAULT_SIM_CONFIG: SimConfig = {
  gridW: 10,
  gridH: 10,
  chadDefault: { x: 5, y: 5 },
  // Towers at grid edges — must match contract defaults in lib.rs.
  towers: {
    N: { x: 5, y: 0 },
    S: { x: 5, y: 9 },
    W: { x: 0, y: 5 },
    E: { x: 9, y: 5 },
  },
};

export function d2(a: Coord, b: Coord): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function bfsDistanceToTarget(from: Coord, to: Coord, w: number, h: number): number {
  if (from.x === to.x && from.y === to.y) return 0;
  const q: Coord[] = [from];
  const seen = new Set<string>([`${from.x},${from.y}`]);
  let depth = 0;
  while (q.length) {
    const size = q.length;
    for (let i = 0; i < size; i++) {
      const cur = q.shift()!;
      const cand: Coord[] = [
        { x: cur.x, y: cur.y - 1 },
        { x: cur.x, y: cur.y + 1 },
        { x: cur.x - 1, y: cur.y },
        { x: cur.x + 1, y: cur.y },
      ];
      for (const n of cand) {
        if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
        if (!canMove4(cur.x, cur.y, n.x, n.y)) continue;
        if (!isAssassinPassable(n.x, n.y)) continue;
        const k = `${n.x},${n.y}`;
        if (seen.has(k)) continue;
        if (n.x === to.x && n.y === to.y) return depth + 1;
        seen.add(k);
        q.push(n);
      }
    }
    depth++;
  }
  return Number.POSITIVE_INFINITY;
}

export function moveToward4(from: Coord, to: Coord): Coord {
  // Legacy helper retained for tests and simple open-grid intuition.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: from.x + Math.sign(dx), y: from.y };
  return { x: from.x, y: from.y + Math.sign(dy) };
}

export function nextStepToward(from: Coord, to: Coord, w: number, h: number): Coord {
  // Shortest-path BFS on a 10x10 is cheap and makes the mansion walls meaningful.
  if (from.x === to.x && from.y === to.y) return from;
  const startKey = `${from.x},${from.y}`;
  const goalKey = `${to.x},${to.y}`;

  const q: Coord[] = [from];
  const prev = new Map<string, string>();
  prev.set(startKey, '');

  const neighbors = (p: Coord): Coord[] => {
    const out: Coord[] = [];
    const cand: Coord[] = [
      { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 },
      { x: p.x - 1, y: p.y },
      { x: p.x + 1, y: p.y },
    ];
    for (const n of cand) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
      if (!canMove4(p.x, p.y, n.x, n.y)) continue;
      if (!isAssassinPassable(n.x, n.y)) continue;
      out.push(n);
    }
    return out;
  };

  while (q.length) {
    const cur = q.shift()!;
    const curKey = `${cur.x},${cur.y}`;
    if (curKey === goalKey) break;
    for (const n of neighbors(cur)) {
      const nk = `${n.x},${n.y}`;
      if (prev.has(nk)) continue;
      prev.set(nk, curKey);
      q.push(n);
    }
  }

  if (!prev.has(goalKey)) {
    // Unreachable due to walls; fallback to the naive greedy step (still clamped by caller).
    const greedy = moveToward4(from, to);
    if (canMove4(from.x, from.y, greedy.x, greedy.y)) return greedy;
    return from;
  }

  // Reconstruct: walk back from goal until we reach the immediate neighbor of start.
  let cursor = goalKey;
  let p = prev.get(cursor) ?? '';
  while (p && p !== startKey) {
    cursor = p;
    p = prev.get(cursor) ?? '';
  }
  const [nx, ny] = cursor.split(',').map((v) => Number(v));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return from;
  return { x: nx, y: ny };
}

export function clampToGrid(p: Coord, w: number, h: number): Coord {
  return {
    x: Math.max(0, Math.min(w - 1, p.x)),
    y: Math.max(0, Math.min(h - 1, p.y)),
  };
}

export function createSecret(seed?: number, avoid?: Coord): SecretState {
  const r = mulberry32(seed ?? Date.now());
  const w = 10;
  const h = 10;

  const randHex32 = (): string => {
    let out = '';
    for (let i = 0; i < 32; i++) out += Math.floor(r() * 256).toString(16).padStart(2, '0');
    return `0x${out}`;
  };

  const randU32 = (): number => Math.floor(r() * 0xffffffff) >>> 0;

  const pickFrom = (list: readonly Coord[]) => {
    if (!list.length) return { x: Math.floor(r() * w), y: Math.floor(r() * h) };
    const idx = Math.floor(r() * list.length);
    return list[Math.max(0, Math.min(list.length - 1, idx))];
  };

  // Spawn rules (single-player sim):
  // - Avoid Chad's tile.
  // - Avoid same-room starts (otherwise the "room capture" rule can feel unfair).
  // - Avoid spawning within 1 move of Chad (e.g. separated only by a door).
  // - Prefer a minimum path distance (respecting walls/doors), so the first turn isn't an insta-loss.
  const MIN_START_PATH = 4;
  const avoidRoom = avoid ? getRoomCodeAt(avoid.x, avoid.y) : null;

  const all: Coord[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isAssassinPassable(x, y)) continue;
      all.push({ x, y });
    }
  }

  const ok = (p: Coord): boolean => {
    if (!avoid) return true;
    if (p.x === avoid.x && p.y === avoid.y) return false;
    if (avoidRoom && getRoomCodeAt(p.x, p.y) === avoidRoom) return false;
    const d = bfsDistanceToTarget(p, avoid, w, h);
    if (!Number.isFinite(d)) return false; // unreachable target => bad gameplay
    return d >= MIN_START_PATH;
  };

  // Prefer "safe" spawns first; if the map is too constrained, relax gradually.
  const safe = all.filter(ok);
  let picked = pickFrom(safe);
  if (avoid && !safe.length) {
    // Relax 1: keep different room and at least not adjacent by path.
    const relaxed1 = all.filter((p) => {
      if (p.x === avoid.x && p.y === avoid.y) return false;
      if (avoidRoom && getRoomCodeAt(p.x, p.y) === avoidRoom) return false;
      const d = bfsDistanceToTarget(p, avoid, w, h);
      return Number.isFinite(d) && d >= 2;
    });
    picked = pickFrom(relaxed1.length ? relaxed1 : all.filter((p) => !(p.x === avoid.x && p.y === avoid.y)));
  }

  const ax = picked.x;
  const ay = picked.y;
  return {
    assassin: { x: ax, y: ay },
    salt: randU32() || 1,
    commitment: `CMT-${Math.floor(r() * 1e9).toString(16)}`,
    commitmentHex: randHex32(),
    last_known_chad: avoid ?? { x: 5, y: 5 },
    seen_chad: [avoid ?? { x: 5, y: 5 }],
  };
}

function pickAnyAssassinMove(from: Coord, target: Coord, w: number, h: number): Coord {
  // Used to enforce "assassin cannot stand still".
  const cand: Coord[] = [
    { x: from.x, y: from.y - 1 },
    { x: from.x, y: from.y + 1 },
    { x: from.x - 1, y: from.y },
    { x: from.x + 1, y: from.y },
  ];
  const legal = cand.filter(
    (n) =>
      n.x >= 0 &&
      n.y >= 0 &&
      n.x < w &&
      n.y < h &&
      canMove4(from.x, from.y, n.x, n.y) &&
      isAssassinPassable(n.x, n.y)
  );
  if (!legal.length) return from;

  const withDist = legal.map((p) => ({ p, d: bfsDistanceToTarget(p, target, w, h) }));
  withDist.sort((a, b) => a.d - b.d || a.p.y - b.p.y || a.p.x - b.p.x);
  return withDist[0].p;
}

export function stepAfterDispatcherAction(
  session: SessionState,
  secret: SecretState,
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): { session: SessionState; secret: SecretState } {
  const out = stepAfterDispatcherActionWithTrace(session, secret, cfg);
  return { session: out.session, secret: out.secret };
}

export function prepareAssassinTurnFromDispatcherAction(
  session: SessionState,
  secret: SecretState,
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): AssassinTurnPrepared | null {
  // Called after the dispatcher has taken an action (PING/RECHARGE) and selected a Chad command.
  if (session.ended || session.phase !== 'dispatcher' || session.turn_step !== 'command') {
    return null;
  }

  // Chad movement (player command), then assassin moves toward Chad (hidden).
  const chad0: Coord = {
    x: typeof session.chad_x === 'number' ? session.chad_x : cfg.chadDefault.x,
    y: typeof session.chad_y === 'number' ? session.chad_y : cfg.chadDefault.y,
  };
  const chad0Room = getRoomCodeAt(chad0.x, chad0.y);

  const prevHideStreak = typeof session.chad_hide_streak === 'number' ? session.chad_hide_streak : 0;
  const rawCmd: ChadCommand = session.pending_chad_cmd ?? 'STAY';
  const cmd: ChadCommand = rawCmd === 'HIDE' && prevHideStreak >= 2 ? 'STAY' : rawCmd;
  const extraNote = rawCmd === 'HIDE' && prevHideStreak >= 2 ? "I can't stay hidden any longer. I have to move." : undefined;

  let { pos: chad1, hidden: chadHidden, note: chadNote } = applyChadCommandRoomLevel(chad0, cmd, session.turn);

  // If Chad is no longer hidden, ensure he is not left standing on a hide-tile coordinate.
  // Hide tiles are "inside" props (closets/pantries). Being visible on that exact square looks like a bug.
  if (!chadHidden && isHideTile(chad1.x, chad1.y)) {
    const popped = popOutOfHideTile(chad1, chad0Room, cfg.gridW, cfg.gridH);
    if (popped && (popped.x !== chad1.x || popped.y !== chad1.y)) {
      chad1 = popped;
      chadNote = chadNote ? `${chadNote} I'm coming out of hiding.` : "I'm coming out of hiding.";
    }
  }

  const hideStreak = chadHidden ? prevHideStreak + 1 : 0;

  let next = append(
    {
      ...session,
      chad_x: chad1.x,
      chad_y: chad1.y,
      pending_chad_cmd: 'STAY',
      chad_hidden: chadHidden,
      chad_hide_streak: hideStreak,
      phase: 'assassin',
    },
    `YOU: ${renderOperatorGuidance(cmd)}`
  );
  next = append(next, `CHAD: ${renderChadFearResponse(cmd, session.turn, session.alpha)}`);
  next = append(next, `YOU: ${renderOperatorReassurance(cmd, session.alpha)}`);
  next = append(next, `CHAD: ${renderChadAck(cmd, session.alpha)}`);
  if (chadNote) next = append(next, `CHAD: ${chadNote}`);
  if (extraNote) next = append(next, `CHAD: ${extraNote}`);
  const room = getRoomDescription(chad1.x, chad1.y);
  const roomCode = getRoomCodeAt(chad1.x, chad1.y);
  const stayedInSameRoom = roomCode === chad0Room;
  next = append(
    next,
    `CHAD: I'm in the ${room.label}. ${room.flavor} ${renderArrivalEmotion(roomCode, session.turn, session.alpha, {
      cmd,
      sameRoom: stayedInSameRoom,
      hidden: chadHidden,
      hideStreak,
    })}`
  );

  // Assassin targets a delayed "last known" Chad location:
  // - When Chad is visible, we record the visible position and set last_known_chad to the position from 2 turns ago.
  // - When Chad hides, we do NOT record/update last_known_chad.
  let seen = secret.seen_chad;
  let lastKnown = secret.last_known_chad;
  if (!chadHidden) {
    seen = [...seen, chad1].slice(-12);
    lastKnown = seen[Math.max(0, seen.length - 3)];
  }

  return {
    session: next,
    secret: { ...secret, last_known_chad: lastKnown, seen_chad: seen },
    from: secret.assassin,
    target: lastKnown,
    chad: chad1,
    chadHidden,
    maxSteps: chadHidden ? 6 : 1,
    mustMove: true,
  };
}

export function prepareAssassinTurnFromAssassinPhase(
  session: SessionState,
  secret: SecretState,
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): AssassinTurnPrepared | null {
  if (session.ended || session.phase !== 'assassin') return null;
  const chad: Coord = {
    x: typeof session.chad_x === 'number' ? session.chad_x : cfg.chadDefault.x,
    y: typeof session.chad_y === 'number' ? session.chad_y : cfg.chadDefault.y,
  };
  // Some on-chain builds can lag or misreport `chad_hidden`; infer hidden mode from the
  // actual hide tile / streak so assassin controls still get the correct 6-step movement.
  const chadHidden = !!session.chad_hidden || !!(session.chad_hide_streak && session.chad_hide_streak > 0) || isHideTile(chad.x, chad.y);
  let seen = secret.seen_chad;
  let lastKnown = secret.last_known_chad;
  if (!chadHidden) {
    const lastSeen = seen[seen.length - 1];
    if (!lastSeen || lastSeen.x !== chad.x || lastSeen.y !== chad.y) {
      seen = [...seen, chad].slice(-12);
      lastKnown = seen[Math.max(0, seen.length - 3)];
    }
  }
  const from = secret.assassin;
  const target = lastKnown;
  const maxSteps = chadHidden ? 6 : 1;
  const forced = pickAnyAssassinMove(from, target, cfg.gridW, cfg.gridH);
  const mustMove = forced.x !== from.x || forced.y !== from.y;
  return {
    session,
    secret: { ...secret, last_known_chad: lastKnown, seen_chad: seen },
    from,
    target,
    chad,
    chadHidden,
    maxSteps,
    mustMove,
  };
}

export function validateManualAssassinPath(
  prepared: AssassinTurnPrepared,
  path: readonly Coord[],
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): AssassinPathValidation {
  const maxSteps = prepared.maxSteps;
  const mustMove = prepared.mustMove;
  if (path.length > maxSteps) {
    return { ok: false, reason: `path exceeds max steps (${path.length}/${maxSteps})`, maxSteps, mustMove };
  }
  if (mustMove && path.length === 0) {
    return { ok: false, reason: 'assassin must move at least one step', maxSteps, mustMove };
  }

  let cur = prepared.from;
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    if (!Number.isFinite(step.x) || !Number.isFinite(step.y)) {
      return { ok: false, reason: `invalid coordinate at step ${i + 1}`, maxSteps, mustMove };
    }
    if (step.x < 0 || step.y < 0 || step.x >= cfg.gridW || step.y >= cfg.gridH) {
      return { ok: false, reason: `out-of-bounds step at ${step.x},${step.y}`, maxSteps, mustMove };
    }
    const manhattan = Math.abs(step.x - cur.x) + Math.abs(step.y - cur.y);
    if (manhattan !== 1) {
      return { ok: false, reason: `step ${i + 1} must be adjacent`, maxSteps, mustMove };
    }
    if (!canMove4(cur.x, cur.y, step.x, step.y) || !isAssassinPassable(step.x, step.y)) {
      return { ok: false, reason: `step ${i + 1} is blocked`, maxSteps, mustMove };
    }
    cur = step;
  }

  return { ok: true, maxSteps, mustMove };
}

export function applyManualAssassinPath(
  prepared: AssassinTurnPrepared,
  pathIn: readonly Coord[],
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): { session: SessionState; secret: SecretState; trace: AssassinMoveTrace } {
  const validation = validateManualAssassinPath(prepared, pathIn, cfg);
  if (!validation.ok) {
    throw new Error(validation.reason ?? 'invalid assassin path');
  }

  const path = pathIn.map((p) => ({ x: p.x, y: p.y }));
  const from = prepared.from;
  let moved = path.length ? path[path.length - 1]! : from;
  moved = clampToGrid(moved, cfg.gridW, cfg.gridH);
  if (path.length) {
    const last = path[path.length - 1]!;
    if (last.x !== moved.x || last.y !== moved.y) path[path.length - 1] = moved;
  }

  const nextSecret: SecretState = { ...prepared.secret, assassin: moved };
  let next = prepared.session;
  const chad1 = prepared.chad;
  const chadHidden = prepared.chadHidden;

  // Status update (d2 to Chad), used to drive alpha and kill.
  const distToChad = d2(moved, chad1);
  next = append(next, `STATUS... D2_CHAD=${distToChad}`);

  if (distToChad === 0) {
    next = append({ ...next, ended: true, outcome: 'loss_caught' }, 'SIGNAL LOST: SCREAM THROUGH STATIC');
    return { session: next, secret: nextSecret, trace: { path, from, to: moved } };
  }

  // Room-level capture: assassin entering Chad's room is lethal unless Chad is hiding.
  const chadRoom = getRoomCodeAt(chad1.x, chad1.y);
  const assassinRoom = getRoomCodeAt(moved.x, moved.y);
  const sameRoom = chadRoom === assassinRoom;
  if (sameRoom && !chadHidden) {
    next = append({ ...next, ended: true, outcome: 'loss_caught' }, 'SIGNAL LOST: FOOTSTEPS IN THE ROOM');
    return { session: next, secret: nextSecret, trace: { path, from, to: moved } };
  }
  if (sameRoom && chadHidden) {
    next = append(next, 'BREATH HELD... HE IS IN THE ROOM');
  }

  // Alpha logic mirrors the contract.
  const strong = distToChad <= 4 || sameRoom;
  const alpha0 = typeof next.alpha === 'number' ? next.alpha : 5;
  const alphaMax = typeof next.alpha_max === 'number' ? next.alpha_max : 5;
  let alpha = alpha0;
  if (strong) alpha = Math.max(0, alpha - 1);
  else alpha = Math.min(alphaMax, alpha + 1);
  next = { ...next, alpha, alpha_max: alphaMax };

  // Foreshadow panic before the terminal hard-fails the run.
  // This keeps the "alpha reset" from feeling like an out-of-nowhere Game Over.
  if (strong) {
    if (alpha === 2) next = append(next, "CHAD: HE'S TOO CLOSE... I CAN'T THINK.");
    if (alpha === 1) next = append(next, "CHAD: I'M PANICKING. DON'T LEAVE ME IN THE DARK.");
  }

  const meter = formatPowerMeter(next.battery).text;
  next = append(next, strong ? `PROXIMITY GLITCH... ${meter}` : `LINE CLEAR... ${meter}`);

  if (alpha === 0) {
    next = append(next, "CHAD: NO. NO. I'M RUNNING.");
    next = append({ ...next, ended: true, outcome: 'loss_panic' }, 'CHAD PANICS: RAN INTO THE FOREST');
    return { session: next, secret: nextSecret, trace: { path, from, to: moved } };
  }

  // Advance the turn and hand control back to dispatcher for next action.
  next = { ...next, turn: next.turn + 1, phase: 'dispatcher', turn_step: 'action', moved_this_turn: false };
  next = append(next, `TURN ${next.turn} READY`);
  const extractionTurn = typeof next.extractionTurn === 'number' ? next.extractionTurn : 10;
  if (next.turn >= extractionTurn) {
    next = append(next, 'SIRENS INBOUND... HOLD YOUR POSITION');
    next = append(next, 'POLICE DISPATCH: VISUAL ON CHAD. TEAM MOVING IN.');
    next = append({ ...next, ended: true, outcome: 'win_extraction' }, 'EXTRACTION COMPLETE: CHAD IS SAFE');
  }
  return { session: next, secret: nextSecret, trace: { path, from, to: moved } };
}

function buildAutoAssassinPath(prepared: AssassinTurnPrepared, cfg: SimConfig): Coord[] {
  const path: Coord[] = [];
  let assassinPos = prepared.from;
  for (let i = 0; i < prepared.maxSteps; i++) {
    const step = nextStepToward(assassinPos, prepared.target, cfg.gridW, cfg.gridH);
    if (step.x === assassinPos.x && step.y === assassinPos.y) break;
    assassinPos = step;
    path.push(assassinPos);
  }
  // Assassin cannot stand still: if no movement happened, force a patrol step.
  if (prepared.mustMove && path.length === 0) {
    const forced = pickAnyAssassinMove(assassinPos, prepared.target, cfg.gridW, cfg.gridH);
    if (forced.x !== prepared.from.x || forced.y !== prepared.from.y) path.push(forced);
  }
  return path;
}

export function stepAfterDispatcherActionWithTrace(
  session: SessionState,
  secret: SecretState,
  cfg: SimConfig = DEFAULT_SIM_CONFIG
): { session: SessionState; secret: SecretState; trace: AssassinMoveTrace } {
  const prepared = prepareAssassinTurnFromDispatcherAction(session, secret, cfg);
  if (!prepared) {
    return { session, secret, trace: { path: [], from: secret.assassin, to: secret.assassin } };
  }
  const autoPath = buildAutoAssassinPath(prepared, cfg);
  return applyManualAssassinPath(prepared, autoPath, cfg);
}

function popOutOfHideTile(from: Coord, room: string, w: number, h: number): Coord | null {
  const q: Coord[] = [from];
  const seen = new Set<string>([`${from.x},${from.y}`]);
  while (q.length) {
    const cur = q.shift()!;
    const cand: Coord[] = [
      { x: cur.x, y: cur.y - 1 },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x + 1, y: cur.y },
    ];
    for (const n of cand) {
      if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= h) continue;
      if (getRoomCodeAt(n.x, n.y) !== room) continue; // don't "pop out" through doors
      if (!canMove4(cur.x, cur.y, n.x, n.y)) continue;
      const k = `${n.x},${n.y}`;
      if (seen.has(k)) continue;
      if (isChadWalkable(n.x, n.y)) return n;
      seen.add(k);
      q.push(n);
    }
  }
  return null;
}

function applyChadCommandRoomLevel(
  p: Coord,
  cmd: ChadCommand,
  seed: number
): { pos: Coord; hidden: boolean; note?: string } {
  const room = getRoomCodeAt(p.x, p.y);
  switch (cmd) {
    case 'WALK_N':
    case 'WALK_S':
    case 'WALK_W':
    case 'WALK_E': {
      if (room !== 'G') return { pos: p, hidden: false, note: 'I can only walk like that inside the garden.' };
      const nx = cmd === 'WALK_W' ? p.x - 1 : cmd === 'WALK_E' ? p.x + 1 : p.x;
      const ny = cmd === 'WALK_N' ? p.y - 1 : cmd === 'WALK_S' ? p.y + 1 : p.y;
      if (getRoomCodeAt(nx, ny) !== 'G') return { pos: p, hidden: false, note: "I can't leave the garden from this angle." };
      if (!canMove4(p.x, p.y, nx, ny)) return { pos: p, hidden: false, note: 'That path is blocked.' };
      // `canMove4` already blocks blocked/hide tiles for Chad via isBlockedTile/isHideTile.
      return { pos: { x: nx, y: ny }, hidden: false, note: "I'm moving." };
    }
    case 'HIDE': {
      const spot = pickHideSpot(room, seed);
      // Chad can only hide if he is within 2 orthogonal steps (Manhattan distance) of a hiding tile.
      const tile = pickHideTileWithin(room, p.x, p.y, seed, 2);
      if (!tile) return { pos: p, hidden: false, note: "I'm too far from a safe hiding spot." };
      return { pos: { x: tile.x, y: tile.y }, hidden: true, note: `I'm hiding ${spot}.` };
    }
    case 'GO_GARDEN':
    case 'GO_HALLWAY':
    case 'GO_LIVING':
    case 'GO_STUDY':
    case 'GO_LIBRARY':
    case 'GO_DINING':
    case 'GO_KITCHEN':
    case 'GO_GRAND_HALL': {
      // Garden is huge; limit which exits Chad can use based on sub-areas.
      if (room === 'G' && p.y >= 0 && p.y <= 2) {
        const inLeft = p.x >= 0 && p.x <= 3;
        const inRight = p.x >= 7 && p.x <= 9;
        const inTopMid = p.x >= 4 && p.x <= 6 && p.y >= 0 && p.y <= 1;
        if (inLeft && cmd === 'GO_LIVING') return { pos: { x: 1, y: 3 }, hidden: false, note: "I'm heading into the living room now." };
        if (inRight && cmd === 'GO_STUDY') return { pos: { x: 8, y: 3 }, hidden: false, note: "I'm heading into the study now." };
        if (inTopMid) {
          if (cmd === 'GO_LIVING') return { pos: { x: 1, y: 3 }, hidden: false, note: "I'm heading into the living room now." };
          if (cmd === 'GO_STUDY') return { pos: { x: 8, y: 3 }, hidden: false, note: "I'm heading into the study now." };
          if (cmd === 'GO_HALLWAY') return { pos: { x: 4, y: 3 }, hidden: false, note: "I'm moving into the hallway now." };
        }
        return { pos: p, hidden: false, note: "I don't have a safe route from here." };
      }

      const toRoom =
        cmd === 'GO_GARDEN'
          ? 'G'
          : cmd === 'GO_HALLWAY'
            ? 'H'
            : cmd === 'GO_LIVING'
              ? 'L'
              : cmd === 'GO_STUDY'
                ? 'S'
                : cmd === 'GO_LIBRARY'
                  ? 'B'
                  : cmd === 'GO_DINING'
                    ? 'D'
                    : cmd === 'GO_KITCHEN'
                      ? 'K'
                      : 'E';

      const ex = findAnyExitToRoom(room, toRoom);
      if (ex) {
        const label = ROOM_LEGEND[ex.toRoom].label;
        return { pos: { x: ex.toX, y: ex.toY }, hidden: false, note: `I'm moving into the ${label} now.` };
      }

      // Fallback matching contract's default entry tiles
      switch (toRoom) {
        case 'G': return { pos: { x: 5, y: 1 }, hidden: false, note: "I'm moving into the garden now." };
        case 'L': return { pos: { x: 1, y: 4 }, hidden: false, note: "I'm moving into the living room now." };
        case 'S': return { pos: { x: 8, y: 4 }, hidden: false, note: "I'm moving into the study now." };
        case 'B': return { pos: { x: 1, y: 7 }, hidden: false, note: "I'm moving into the library now." };
        case 'D': return { pos: { x: 8, y: 6 }, hidden: false, note: "I'm moving into the dining room now." };
        case 'K': return { pos: { x: 8, y: 8 }, hidden: false, note: "I'm moving into the kitchen now." };
        case 'E': return { pos: { x: 4, y: 8 }, hidden: false, note: "I'm moving into the grand hall now." };
        default: return { pos: { x: 4, y: 5 }, hidden: false, note: "I'm moving into the hallway now." };
      }
    }
    case 'STAY':
    default:
      return { pos: p, hidden: false };
  }
}

function renderChadAck(cmd: ChadCommand, alpha?: number): string {
  const tone = toneStage(alpha);
  switch (cmd) {
    case 'WALK_N':
    case 'WALK_S':
    case 'WALK_W':
    case 'WALK_E':
      if (tone === 'calm') return "Yeah, yeah. I'm moving through the garden.";
      if (tone === 'shaken') return "I'm moving through the garden. Just keep talking.";
      return "I'm moving through the garden. I can't stay still here.";
    case 'GO_GARDEN':
    case 'GO_HALLWAY':
    case 'GO_LIVING':
    case 'GO_STUDY':
    case 'GO_LIBRARY':
    case 'GO_DINING':
    case 'GO_KITCHEN':
    case 'GO_GRAND_HALL':
      if (tone === 'calm') return "I'm moving. Keep comms open.";
      if (tone === 'shaken') return "I'm moving. Stay on comms with me.";
      return "I'm moving now. Don't drop comms, please.";
    case 'HIDE':
      if (tone === 'calm') return "Fine. I'm taking cover and staying quiet.";
      return "I'm hiding. Staying quiet. Just keep me updated.";
    case 'STAY':
    default:
      return tone === 'panic' ? "Holding. Don't lose me." : "Holding. Don't drift off comms.";
  }
}

function renderOperatorGuidance(cmd: ChadCommand): string {
  switch (cmd) {
    case 'GO_GARDEN':
      return 'Chad, move to the garden. Stay low and keep your breathing steady.';
    case 'GO_HALLWAY':
      return 'Chad, head to the hallway. Stay close to the wall and move quietly.';
    case 'GO_LIVING':
      return 'Chad, move into the living room. Stay calm and watch every doorway.';
    case 'GO_STUDY':
      return 'Chad, go to the study. Stay focused and keep noise to a minimum.';
    case 'GO_LIBRARY':
      return 'Chad, move to the library. Stay out of sight between the shelves.';
    case 'GO_DINING':
      return 'Chad, head to the dining room. Keep moving, but do not rush.';
    case 'GO_KITCHEN':
      return 'Chad, move to the kitchen. Stay alert and listen for footsteps.';
    case 'GO_GRAND_HALL':
      return 'Chad, go to the grand hall. Move carefully and keep your head down.';
    case 'WALK_N':
      return 'Chad, take a few careful steps north through the garden.';
    case 'WALK_S':
      return 'Chad, take a few careful steps south through the garden.';
    case 'WALK_W':
      return 'Chad, slide west through the garden, slow and quiet.';
    case 'WALK_E':
      return 'Chad, move east through the garden and stay in cover.';
    case 'HIDE':
      return 'Chad, find cover now. Stay silent until I call you out.';
    case 'STAY':
    default:
      return 'Chad, hold your position. Slow breaths, stay with me.';
  }
}

function renderOperatorReassurance(cmd: ChadCommand, alpha?: number): string {
  const tone = toneStage(alpha);
  if (tone === 'calm') {
    switch (cmd) {
      case 'HIDE':
        return "Good choice. Stay low, stay quiet, and keep breathing with me.";
      case 'STAY':
        return "Hold steady. You're in control, and I've got your position.";
      default:
        return "You're good, Chad. One clean move at a time, I'm tracking you.";
    }
  }

  if (tone === 'shaken') {
    switch (cmd) {
      case 'HIDE':
        return "You're doing fine. Keep low, count your breaths, and stay with my voice.";
      case 'STAY':
        return "Stay with me, Chad. You're not alone, and you're still ahead of him.";
      default:
        return "Keep moving, eyes up. Short breaths in, long breaths out. You're doing this.";
    }
  }

  switch (cmd) {
    case 'HIDE':
      return "Listen to me: freeze low, stay silent, breathe in for four, out for four. I'm here.";
    case 'STAY':
      return "Chad, lock in on my voice. Don't spiral. You're not alone and you're not done.";
    default:
      return "Stay with me right now. One step only, then another. Keep talking to me.";
  }
}

function renderChadFearResponse(cmd: ChadCommand, turn: number, alpha?: number): string {
  const tone = toneStage(alpha);
  const ambient = [
    "I'm not freaking out, okay? It's just pitch-black in here and I can barely see.",
    "It's freezing, my hands are numb, and this storm is louder than the stadium on rivalry night.",
    "Whole house is shaking from thunder. If that psycho is close, I won't see him till he's on me.",
  ] as const;
  const shakenAmbient = [
    "I keep talking tough, but I can barely see and it's freezing in here.",
    "This storm is insane... thunder's covering every sound and I hate that.",
    "I can't read this place in the dark. If he rushes me, I'm done.",
  ] as const;
  const panicAmbient = [
    "I can't see, I can't warm up, I can't hear over the storm. I'm slipping here.",
    "This isn't me talking trash anymore. I'm scared and he's close.",
    "Everything's shaking, it's freezing, and I think he's hunting my voice.",
  ] as const;

  if (cmd === 'HIDE') {
    if (tone === 'calm') return "I hate this. It's dark, cold, and he's hunting me. I'll hide, just keep talking.";
    if (tone === 'shaken') return "I'm shaking. It's dark, cold, and I swear he's close. I'll hide.";
    return "I'm hiding now. Please keep talking, I can't do silence right now.";
  }
  if (cmd === 'STAY') {
    if (tone === 'calm') return "I'm staying put, but I swear I hear his steps in these halls.";
    if (tone === 'shaken') return "I'll hold... but I can hear movement and it's getting closer.";
    return "I'm holding, but I'm one second away from bolting.";
  }
  if (tone === 'calm') return ambient[turn % ambient.length];
  if (tone === 'shaken') return shakenAmbient[turn % shakenAmbient.length];
  return panicAmbient[turn % panicAmbient.length];
}

function renderArrivalEmotion(
  roomCode: string,
  turn: number,
  alpha?: number,
  context?: { cmd: ChadCommand; sameRoom: boolean; hidden: boolean; hideStreak: number }
): string {
  const tone = toneStage(alpha);
  if (context?.sameRoom && context.cmd === 'STAY') {
    const stayCalm = [
      "I'm still here. Holding like you said.",
      "Same room, same spot. I'm keeping my head on a swivel.",
      "Still in place. Not making noise.",
    ] as const;
    const stayShaken = [
      "Still here. I don't like staying exposed this long.",
      "I'm holding, but this silence is messing with me.",
      "Same room. I keep hearing creaks that aren't me.",
    ] as const;
    const stayPanic = [
      "Still here. I can't hold forever, he's close.",
      "I'm in the same room and I'm starting to spiral.",
      "Holding, barely. Please don't go quiet on me.",
    ] as const;
    if (tone === 'calm') return stayCalm[turn % stayCalm.length];
    if (tone === 'shaken') return stayShaken[turn % stayShaken.length];
    return stayPanic[turn % stayPanic.length];
  }

  if (context?.sameRoom && context.cmd === 'HIDE') {
    if (!context.hidden) {
      return "I couldn't get properly hidden here. I'm still exposed in this room.";
    }
    if (context.hideStreak >= 2) {
      return "I've hidden here too long already. I can't keep doing this in one place.";
    }
    const hideCalm = [
      "I'm still hidden in this room. Keeping low and quiet.",
      "Same room, tucked away. I don't think he saw me.",
    ] as const;
    const hideShaken = [
      "Still hidden in here. My legs are cramping but I'm staying down.",
      "Same room, still in cover. Every thunder crack feels like a footstep.",
    ] as const;
    const hidePanic = [
      "Still hiding in this room. I can't keep this up much longer.",
      "I'm still in cover, but I'm shaking so hard I can hear it.",
    ] as const;
    if (tone === 'calm') return hideCalm[turn % hideCalm.length];
    if (tone === 'shaken') return hideShaken[turn % hideShaken.length];
    return hidePanic[turn % hidePanic.length];
  }

  if (roomCode === 'D') {
    if (tone === 'calm') {
      return "Dining room. My plate's still here, gone cold. I was halfway through eating when this nightmare started.";
    }
    if (tone === 'shaken') {
      return "Dining room. Food's still on the table, cold now. This was supposed to be a normal night.";
    }
    return "Dining room. My food's still here and I can't even swallow. I was just eating before he came.";
  }
  if (roomCode === 'K') {
    return tone === 'panic'
      ? "Kitchen's freezing. Counters feel like ice and I can't stop shaking."
      : "Kitchen's dead cold. Counter feels like ice and the lights are still out.";
  }
  if (roomCode === 'H') {
    return tone === 'panic'
      ? "Hallway's echoing too hard. Every sound feels like he's right behind me."
      : "Hallway's tight and echoing. Every sound bounces like someone's right behind me.";
  }
  if (roomCode === 'G') {
    return "Rain's smashing the glass. Biggest storm this city's ever seen and I'm stuck in here with a killer.";
  }
  const tails = [
    "I still can't see much. Keep talking so I don't lose it.",
    "I talk big, but this is bad. I keep hearing him behind me.",
    "Cold, dark, thunder every five seconds... this place is cursed.",
  ] as const;
  const panicTails = [
    "I can't keep pretending I'm fine. Stay on comms with me.",
    "If I go quiet, call my name. I need your voice right now.",
    "I'm trying not to panic, but I'm close. Really close.",
  ] as const;
  if (tone === 'panic') return panicTails[turn % panicTails.length];
  return tails[turn % tails.length];
}

function toneStage(alpha?: number): 'calm' | 'shaken' | 'panic' {
  const a = typeof alpha === 'number' ? alpha : 5;
  if (a <= 2) return 'panic';
  if (a <= 3) return 'shaken';
  return 'calm';
}

function append(session: SessionState, line: string): SessionState {
  const log = session.log.length > 200 ? session.log.slice(session.log.length - 200) : session.log;
  return { ...session, log: [...log, line] };
}

function mulberry32(a: number) {
  let t = a >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
