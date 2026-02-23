import type { ChadCommand, GameMode, SessionState, TowerId } from './model';
import { isChadSpawnable } from './world/floorplan';
import { isChadCommandAllowed } from './sim/chadOptions';

export const DEFAULTS = {
  batteryMax: 100,
  pingCost: 20,
  rechargeAmount: 10,
  extractionTurn: 10,
  gridW: 10,
  gridH: 10,
} as const;

export function createSession(params: {
  sessionId: number;
  mode: GameMode;
  dispatcher: string;
  assassin: string;
}): SessionState {
  const chad = randomChadCoord(DEFAULTS.gridW, DEFAULTS.gridH);
  return {
    sessionId: params.sessionId,
    mode: params.mode,
    dispatcher: params.dispatcher,
    assassin: params.assassin,
    commitmentSet: false,
    battery: DEFAULTS.batteryMax,
    pingCost: DEFAULTS.pingCost,
    rechargeAmount: DEFAULTS.rechargeAmount,
    turn: 0,
    extractionTurn: DEFAULTS.extractionTurn,
    phase: 'dispatcher',
    turn_step: 'action',
    ended: false,
    outcome: undefined,
    alpha: 5,
    alpha_max: 5,
    moved_this_turn: false,
    chad_x: chad.x,
    chad_y: chad.y,
    pending_chad_cmd: 'STAY',
    chad_hidden: false,
    chad_hide_streak: 0,
    log: ['LINK ESTABLISHED', 'STORM WARNING: GENERATOR ONLINE'],
  };
}

export function setChadCommand(state: SessionState, actor: string, cmd: ChadCommand): SessionState {
  if (state.ended) return append(state, 'ERR: SESSION ENDED');
  if (actor !== state.dispatcher) return append(state, 'ERR: UNAUTHORIZED (DISPATCHER ONLY)');
  if (state.phase !== 'dispatcher') return append(state, 'ERR: NOT DISPATCHER TURN');
  if (state.turn_step !== 'command') return append(state, 'ERR: COMMAND LOCKED (PING FIRST)');
  if (!isChadCommandAllowed(state, cmd)) return append(state, 'ERR: COMMAND NOT AVAILABLE');
  // Do not write to the RADIO LOG here; we want the log order to be:
  // PING/RECHARGE first, then Chad movement/ack, then assassin status.
  return { ...state, pending_chad_cmd: cmd };
}

export function commitLocation(state: SessionState, actor: string): SessionState {
  if (state.ended) return append(state, 'ERR: SESSION ENDED');
  if (actor !== state.assassin) return append(state, 'ERR: UNAUTHORIZED (ASSASSIN ONLY)');
  if (state.commitmentSet) return append(state, 'WARN: COMMITMENT ALREADY SET');
  return { ...append(state, 'COMMITMENT SET'), commitmentSet: true };
}

export function requestPing(state: SessionState, actor: string, tower: TowerId): SessionState {
  if (state.ended) return append(state, 'ERR: SESSION ENDED');
  if (actor !== state.dispatcher) return append(state, 'ERR: UNAUTHORIZED (DISPATCHER ONLY)');
  if (state.phase !== 'dispatcher') return append(state, 'ERR: NOT DISPATCHER TURN');
  if (state.turn_step !== 'action') return append(state, 'ERR: ACTION ALREADY TAKEN');
  if (!state.commitmentSet) return append(state, 'ERR: NO COMMITMENT');
  if (state.battery < state.pingCost) return append(state, 'ERR: INSUFFICIENT POWER');

  const battery = state.battery - state.pingCost;
  const next = append(
    { ...state, battery, turn_step: 'command' },
    `PING ${tower}... EST. DRAIN: -${state.pingCost}%`
  );

  if (battery === 0) {
    return append({ ...next, ended: true, outcome: 'loss_blackout' }, 'BLACKOUT: TERMINAL OFFLINE');
  }
  return next;
}

export function recharge(state: SessionState, actor: string): SessionState {
  if (state.ended) return append(state, 'ERR: SESSION ENDED');
  if (actor !== state.dispatcher) return append(state, 'ERR: UNAUTHORIZED (DISPATCHER ONLY)');
  if (state.phase !== 'dispatcher') return append(state, 'ERR: NOT DISPATCHER TURN');
  if (state.turn_step !== 'action') return append(state, 'ERR: ACTION ALREADY TAKEN');
  if (!state.commitmentSet) return append(state, 'ERR: NO COMMITMENT');

  const battery = Math.min(DEFAULTS.batteryMax, state.battery + state.rechargeAmount);
  return append(
    { ...state, battery, turn_step: 'command' },
    `RECHARGE... +${state.rechargeAmount}% (BLIND TURN)`
  );
}

export function assassinTick(state: SessionState, actor: string): SessionState {
  if (state.ended) return append(state, 'ERR: SESSION ENDED');
  if (actor !== state.assassin) return append(state, 'ERR: UNAUTHORIZED (ASSASSIN ONLY)');
  if (state.phase !== 'assassin') return append(state, 'ERR: NOT ASSASSIN TURN');

  return append(
    { ...state, turn: state.turn + 1, phase: 'dispatcher', moved_this_turn: false },
    `TURN ${state.turn + 1}...`
  );
}

function append(state: SessionState, line: string): SessionState {
  const log = state.log.length > 200 ? state.log.slice(state.log.length - 200) : state.log;
  return { ...state, log: [...log, line] };
}

function randomChadCoord(w: number, h: number): { x: number; y: number } {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const u = new Uint32Array(2);
    for (let i = 0; i < 50; i++) {
      crypto.getRandomValues(u);
      const x = u[0] % w;
      const y = u[1] % h;
      if (isChadSpawnable(x, y)) return { x, y };
    }
    // fallback: deterministic scan
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isChadSpawnable(x, y)) return { x, y };
    return { x: 0, y: 0 };
  }
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (isChadSpawnable(x, y)) return { x, y };
  }
  return { x: 0, y: 0 };
}
