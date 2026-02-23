import { describe, expect, test } from 'bun:test';
import { commitLocation, createSession, recharge, requestPing, setChadCommand } from './localBackend';
import { isChadSpawnable } from './world/floorplan';

describe('localBackend (phase 2 mock)', () => {
  test('session initializes with battery 100, costs 20/10, dispatcher turn', () => {
    const s = createSession({
      sessionId: 1,
      mode: 'single',
      dispatcher: 'GDISP',
      assassin: 'GASS',
    });
    expect(s.battery).toBe(100);
    expect(s.pingCost).toBe(20);
    expect(s.rechargeAmount).toBe(10);
    expect(s.phase).toBe('dispatcher');
    expect(s.turn_step).toBe('action');
    expect(s.ended).toBe(false);
    expect(s.extractionTurn).toBe(10);
    expect(s.outcome).toBeUndefined();
    expect(typeof s.chad_x).toBe('number');
    expect(typeof s.chad_y).toBe('number');
    expect((s.chad_x as number) >= 0 && (s.chad_x as number) < 10).toBe(true);
    expect((s.chad_y as number) >= 0 && (s.chad_y as number) < 10).toBe(true);
    expect(isChadSpawnable(s.chad_x as number, s.chad_y as number)).toBe(true);
  });

  test('commit requires assassin', () => {
    const s0 = createSession({ sessionId: 1, mode: 'single', dispatcher: 'D', assassin: 'A' });
    const s1 = commitLocation(s0, 'D');
    expect(s1.commitmentSet).toBe(false);
    expect(s1.log.at(-1)).toMatch(/UNAUTHORIZED/);

    const s2 = commitLocation(s0, 'A');
    expect(s2.commitmentSet).toBe(true);
  });

  test('ping requires commitment, costs battery, flips phase', () => {
    const s0 = createSession({ sessionId: 1, mode: 'single', dispatcher: 'D', assassin: 'A' });
    const s1 = requestPing(s0, 'D', 'N');
    expect(s1.log.at(-1)).toMatch(/NO COMMITMENT/);

    const s2 = commitLocation(s0, 'A');
    const s3 = requestPing(s2, 'D', 'N');
    expect(s3.battery).toBe(80);
    expect(s3.phase).toBe('dispatcher');
    expect(s3.turn_step).toBe('command');
  });

  test('recharge caps at 100 and flips phase', () => {
    const s0 = createSession({ sessionId: 1, mode: 'single', dispatcher: 'D', assassin: 'A' });
    const s1 = commitLocation(s0, 'A');
    const s2 = requestPing(s1, 'D', 'N');
    // Simulate command resolution by manually restoring action step for next action in this unit test.
    const s3 = { ...s2, turn_step: 'action' };
    const s4 = recharge(s3, 'D');
    expect(s4.battery).toBe(90);
    expect(s4.phase).toBe('dispatcher');
    expect(s4.turn_step).toBe('command');

    const s5 = { ...s4, turn_step: 'action' };
    const s6 = recharge(s5, 'D');
    expect(s6.battery).toBe(100);
  });

  test('battery depletion ends the session', () => {
    let s = createSession({ sessionId: 1, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    for (let i = 0; i < 4; i++) {
      s = requestPing(s, 'D', 'N');
      s = { ...s, turn_step: 'action' };
    }
    s = requestPing(s, 'D', 'N'); // 5th ping -> 0
    expect(s.battery).toBe(0);
    expect(s.ended).toBe(true);
    expect(s.outcome).toBe('loss_blackout');
    expect(s.log.at(-1)).toMatch(/BLACKOUT/);
  });

  test('dispatcher can set a Chad command during dispatcher phase', () => {
    let s = createSession({ sessionId: 1, mode: 'single', dispatcher: 'D', assassin: 'A' });
    // Put Chad in a deterministic place with a known option.
    s = { ...s, chad_x: 0, chad_y: 2 }; // left garden => only GO_LIVING
    s = { ...s, turn_step: 'command' };
    s = setChadCommand(s, 'D', 'GO_LIVING');
    expect(s.pending_chad_cmd).toBe('GO_LIVING');
  });

  test('dispatcher cannot set an unavailable Chad command', () => {
    let s = createSession({ sessionId: 2, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = { ...s, chad_x: 0, chad_y: 2 }; // left garden => only GO_LIVING
    s = { ...s, turn_step: 'command' };
    const s2 = setChadCommand(s, 'D', 'GO_STUDY');
    expect(s2.pending_chad_cmd).toBe('STAY');
    expect(s2.log.at(-1)).toMatch(/COMMAND NOT AVAILABLE/);
  });
});
