import { describe, expect, test } from 'bun:test';
import { getAvailableChadCommands } from './chadOptions';
import type { SessionState } from '../model';

function mkSession(partial: Partial<SessionState>): SessionState {
  return {
    sessionId: 1,
    mode: 'single',
    dispatcher: 'D',
    assassin: 'A',
    commitmentSet: true,
    battery: 100,
    pingCost: 20,
    rechargeAmount: 10,
    turn: 0,
    phase: 'dispatcher',
    turn_step: 'command',
    ended: false,
    log: [],
    chad_x: 3,
    chad_y: 9,
    pending_chad_cmd: 'STAY',
    chad_hidden: false,
    chad_hide_streak: 0,
    ...partial,
  };
}

describe('sim/chadOptions', () => {
  test('HIDE is not offered when hide streak is maxed', () => {
    const s = mkSession({ chad_hide_streak: 2 });
    const opts = getAvailableChadCommands(s);
    expect(opts.some((o) => o.cmd === 'HIDE')).toBe(false);
  });

  test('garden offers WALK options when the neighbor tile is still garden', () => {
    const s = mkSession({ chad_x: 5, chad_y: 1 }); // garden top-mid
    const opts = getAvailableChadCommands(s);
    expect(opts.some((o) => o.cmd === 'WALK_W' || o.cmd === 'WALK_E' || o.cmd === 'WALK_S' || o.cmd === 'WALK_N')).toBe(true);
  });
});
