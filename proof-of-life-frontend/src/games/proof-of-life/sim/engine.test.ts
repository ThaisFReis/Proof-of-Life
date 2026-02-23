import { describe, expect, test } from 'bun:test';
import { createSecret, d2, moveToward4, nextStepToward, stepAfterDispatcherAction } from './engine';
import { createSession, requestPing, commitLocation, setChadCommand } from '../localBackend';
import { canMove4 } from '../world/floorplan';
import { isAssassinPassable } from '../world/floorplan';
import { isHideTile } from '../world/floorplan';
import { getRoomCodeAt } from '../world/floorplan';

describe('sim/engine (phase 5 single-player)', () => {
  function pathDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
    if (from.x === to.x && from.y === to.y) return 0;
    const q: { x: number; y: number }[] = [from];
    const seen = new Set<string>([`${from.x},${from.y}`]);
    let depth = 0;
    while (q.length) {
      const size = q.length;
      for (let i = 0; i < size; i++) {
        const cur = q.shift()!;
        const cand = [
          { x: cur.x, y: cur.y - 1 },
          { x: cur.x, y: cur.y + 1 },
          { x: cur.x - 1, y: cur.y },
          { x: cur.x + 1, y: cur.y },
        ];
        for (const n of cand) {
          if (n.x < 0 || n.y < 0 || n.x >= 10 || n.y >= 10) continue;
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

  test('moveToward4 moves exactly 1 step in manhattan distance', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4, y: 3 };
    const m = moveToward4(a, b);
    const manhattan = Math.abs(m.x - a.x) + Math.abs(m.y - a.y);
    expect(manhattan).toBe(1);
  });

  test('createSecret spawns assassin away from Chad (not adjacent by path, not same room)', () => {
    const chad = { x: 1, y: 3 }; // living room
    const chadRoom = getRoomCodeAt(chad.x, chad.y);
    for (let seed = 0; seed < 100; seed++) {
      const secret = createSecret(seed, chad);
      const a = secret.assassin;
      expect(a.x === chad.x && a.y === chad.y).toBe(false);
      expect(getRoomCodeAt(a.x, a.y)).not.toBe(chadRoom);
      const d = pathDistance(a, chad);
      // Door-adjacent starts are the main unfair case; require at least 2 moves.
      expect(d).toBeGreaterThanOrEqual(2);
    }
  });

  test('nextStepToward respects mansion walls (no diagonal, no wall-crossing)', () => {
    const from = { x: 4, y: 3 };
    const to = { x: 4, y: 2 };
    const step = nextStepToward(from, to, 10, 10);
    // If a wall blocks directly, it may pick an alternate. In all cases it must be 1 tile away and legal.
    const manhattan = Math.abs(step.x - from.x) + Math.abs(step.y - from.y);
    expect(manhattan).toBe(1);
    expect(canMove4(from.x, from.y, step.x, step.y)).toBe(true);
    expect(isAssassinPassable(step.x, step.y)).toBe(true);
  });

  test('d2 computes squared euclidean distance', () => {
    expect(d2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });

  test('stepAfterDispatcherAction can end game when assassin reaches Chad', () => {
    const sessionId = 1;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = requestPing(s, 'D', 'N'); // makes phase 'assassin'

    // Force Chad to a known tile so the test is deterministic.
    s = { ...s, chad_x: 5, chad_y: 5 };
    const secret = { assassin: { x: 5, y: 5 }, commitment: 'C', last_known_chad: { x: 5, y: 5 }, seen_chad: [{ x: 5, y: 5 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.ended).toBe(true);
    expect(out.session.outcome).toBe('loss_caught');
  });

  test('stepAfterDispatcherAction advances turn back to dispatcher when not ended', () => {
    const sessionId = 2;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = requestPing(s, 'D', 'N'); // makes phase 'assassin'

    // Make positions deterministic and far apart so the step cannot end immediately.
    s = { ...s, chad_x: 0, chad_y: 9 };
    const secret = { assassin: { x: 9, y: 0 }, commitment: 'C', last_known_chad: { x: 0, y: 9 }, seen_chad: [{ x: 0, y: 9 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.phase).toBe('dispatcher');
    expect(out.session.turn).toBe(1);
  });

  test('triggers extraction win at turn 10 when Chad survives', () => {
    let s = createSession({ sessionId: 200, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    // Prepare a safe resolve right before extraction threshold.
    s = { ...s, turn: 9, chad_x: 0, chad_y: 9 };
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'STAY');
    const secret = { assassin: { x: 9, y: 0 }, commitment: 'C', last_known_chad: { x: 0, y: 9 }, seen_chad: [{ x: 0, y: 9 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.turn).toBe(10);
    expect(out.session.ended).toBe(true);
    expect(out.session.outcome).toBe('win_extraction');
    expect(out.session.log.join('\n')).toMatch(/EXTRACTION COMPLETE: CHAD IS SAFE/);
  });

  test('does not trigger extraction before turn 10', () => {
    let s = createSession({ sessionId: 201, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = { ...s, turn: 8, chad_x: 0, chad_y: 9 };
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'STAY');
    const secret = { assassin: { x: 9, y: 0 }, commitment: 'C', last_known_chad: { x: 0, y: 9 }, seen_chad: [{ x: 0, y: 9 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.turn).toBe(9);
    expect(out.session.ended).toBe(false);
    expect(out.session.outcome).not.toBe('win_extraction');
  });

  test('death still wins over extraction when both would coincide', () => {
    let s = createSession({ sessionId: 202, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    // Turn threshold would be hit, but Chad is caught first in this resolve.
    s = { ...s, turn: 9, chad_x: 5, chad_y: 5 };
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'STAY');
    const secret = { assassin: { x: 5, y: 5 }, commitment: 'C', last_known_chad: { x: 5, y: 5 }, seen_chad: [{ x: 5, y: 5 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.ended).toBe(true);
    expect(out.session.outcome).toBe('loss_caught');
    expect(out.session.log.join('\n')).not.toMatch(/EXTRACTION COMPLETE: CHAD IS SAFE/);
  });

  test('alpha panic is foreshadowed in the radio log before CHAD PANICS', () => {
    const sessionId = 99;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');

    // Put Chad near a hide tile and set alpha low so the panic condition triggers deterministically.
    s = { ...s, chad_x: 1, chad_y: 3, alpha: 1, alpha_max: 5 };

    // Make it an assassin step (after dispatcher action).
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'HIDE');
    const secret = {
      assassin: { x: 2, y: 3 }, // same room, 2 steps away; will move closer but not onto Chad's tile
      commitment: 'C',
      last_known_chad: { x: 1, y: 3 },
      seen_chad: [{ x: 1, y: 3 }],
    };

    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.ended).toBe(true);
    expect(out.session.outcome).toBe('loss_panic');
    const log = out.session.log.join('\n');
    // Should warn that Chad is panicking before the final panic line.
    expect(log).toMatch(/CHAD:\s*(PANIC|BREATHING|I CAN'T|DON'T LEAVE|NO\.\s*NO)/i);
    expect(log).toMatch(/CHAD PANICS: RAN INTO THE FOREST/);
  });

  test('STAY after HIDE pops Chad out of the hide tile (no lingering on hide block)', () => {
    const sessionId = 101;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');

    // Put Chad near a known hide tile in the living room so HIDE succeeds.
    s = { ...s, chad_x: 1, chad_y: 3 };

    // Turn 0: action then HIDE command.
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'HIDE');
    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 1, y: 3 }, seen_chad: [{ x: 1, y: 3 }] };
    const out1 = stepAfterDispatcherAction(s, secret);
    expect(out1.session.chad_hidden).toBe(true);
    expect(isHideTile(out1.session.chad_x as number, out1.session.chad_y as number)).toBe(true);

    // Turn 1: next action then STAY should make him come out of the hide tile.
    let s2 = requestPing(out1.session, 'D', 'N');
    s2 = setChadCommand(s2, 'D', 'STAY');
    const out2 = stepAfterDispatcherAction(s2, out1.secret);
    expect(out2.session.chad_hidden).toBe(false);
    expect(isHideTile(out2.session.chad_x as number, out2.session.chad_y as number)).toBe(false);
  });

  test('Chad command affects distance (moving away helps)', () => {
    const sessionId = 3;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    // Place Chad in left garden so the only move option is GO_LIVING.
    s = { ...s, chad_x: 0, chad_y: 2 };
    s = requestPing(s, 'D', 'N'); // action first
    s = setChadCommand(s, 'D', 'GO_LIVING'); // then command unlocked

    // Put assassin far so this cannot end immediately.
    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 0, y: 2 }, seen_chad: [{ x: 0, y: 2 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.ended).toBe(false);
    expect(getRoomCodeAt(out.session.chad_x as number, out.session.chad_y as number)).toBe('L');
  });

  test('room-level capture: assassin in same room kills unless Chad is hiding', () => {
    const sessionId = 4;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    // Put Chad in the living room blob (x 0..2, y 3..4 in our layout).
    // Use a tile that is not a hide tile so "not hiding" is meaningful.
    s = { ...s, chad_x: 1, chad_y: 3 };

    // Put assassin in hallway right outside the living-room door at (3,3).
    // With the new door set, L<->H is only open at (2,3)-(3,3), so assassin should enter living at (2,3).
    const secret = { assassin: { x: 3, y: 3 }, commitment: 'C', last_known_chad: { x: 1, y: 3 }, seen_chad: [{ x: 1, y: 3 }] };

    // If Chad doesn't hide, assassin entering the room is fatal.
    let s1 = requestPing(s, 'D', 'N');
    s1 = setChadCommand(s1, 'D', 'STAY');
    const out1 = stepAfterDispatcherAction(s1, secret);
    expect(out1.session.ended).toBe(true);

    // If Chad hides, same-room presence is survivable (for now).
    let s2 = requestPing(s, 'D', 'N');
    s2 = setChadCommand(s2, 'D', 'HIDE');
    const out2 = stepAfterDispatcherAction(s2, secret);
    expect(out2.session.ended).toBe(false);
    expect(out2.session.chad_hidden).toBe(true);
    // Chad should have moved onto a hide tile (same room, assassin-blocked).
    expect(out2.session.chad_x).not.toBe(1);
  });

  test('HIDE only works within manhattan distance <= 2 (no diagonal shortcut)', () => {
    const sessionId = 5;
    let s = createSession({ sessionId, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');

    // Put Chad far from any hide tile in the Garden.
    // Garden hide tiles are currently at (1,1) and (8,0); (9,2) is manhattan 3 from (8,0).
    s = { ...s, chad_x: 9, chad_y: 2 };
    // Bypass localBackend validation to test engine semantics directly.
    s = { ...s, pending_chad_cmd: 'HIDE' };
    s = requestPing(s, 'D', 'N');

    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 9, y: 2 }, seen_chad: [{ x: 9, y: 2 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.chad_hidden).toBe(false);
    expect(out.session.log.join('\n')).toMatch(/too far from a safe hiding spot/i);
  });

  test('garden is subdivided: left exits only to living, right only to study, top-mid can go living/study/hall', () => {
    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 0, y: 0 }, seen_chad: [{ x: 0, y: 0 }] };

    // Left garden -> living only.
    let s1 = createSession({ sessionId: 6, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s1 = commitLocation(s1, 'A');
    s1 = { ...s1, chad_x: 0, chad_y: 2 };
    s1 = requestPing(s1, 'D', 'N');
    s1 = setChadCommand(s1, 'D', 'GO_LIVING');
    const o1 = stepAfterDispatcherAction(s1, secret);
    expect(getRoomCodeAt(o1.session.chad_x as number, o1.session.chad_y as number)).toBe('L');

    // Right garden -> study only.
    let s2 = createSession({ sessionId: 7, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s2 = commitLocation(s2, 'A');
    s2 = { ...s2, chad_x: 9, chad_y: 2 };
    s2 = requestPing(s2, 'D', 'N');
    s2 = setChadCommand(s2, 'D', 'GO_STUDY');
    const o2 = stepAfterDispatcherAction(s2, secret);
    expect(getRoomCodeAt(o2.session.chad_x as number, o2.session.chad_y as number)).toBe('S');

    // Top-mid garden: GO_HALLWAY -> hallway via new door at (4,1)-(4,2).
    let s3 = createSession({ sessionId: 8, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s3 = commitLocation(s3, 'A');
    s3 = { ...s3, chad_x: 5, chad_y: 1 };
    s3 = requestPing(s3, 'D', 'N');
    s3 = setChadCommand(s3, 'D', 'GO_HALLWAY');
    const o3 = stepAfterDispatcherAction(s3, secret);
    expect(getRoomCodeAt(o3.session.chad_x as number, o3.session.chad_y as number)).toBe('H');
  });

  test('assassin pursues last known Chad location when Chad is hidden', () => {
    // Chad hides in Living, but assassin should keep chasing the last known spot in Garden.
    let s = createSession({ sessionId: 9, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = { ...s, chad_x: 1, chad_y: 3 }; // living
    s = requestPing(s, 'D', 'N');
    // Bypass availability validation; we want to test AI targeting.
    s = { ...s, pending_chad_cmd: 'HIDE' };

    const secret = {
      assassin: { x: 9, y: 9 },
      commitment: 'C',
      last_known_chad: { x: 0, y: 2 }, // garden (left)
      seen_chad: [{ x: 0, y: 2 }],
    };

    const out = stepAfterDispatcherAction(s, secret);
    // last_known_chad must remain the old value since Chad hid.
    expect(out.secret.last_known_chad).toEqual({ x: 0, y: 2 });
  });

  test('assassin uses a 2-turn delay for last_known_chad when Chad is visible', () => {
    // After 3 visible positions A,B,C, last_known should be A (2 turns behind C).
    const secret0 = {
      assassin: { x: 9, y: 9 },
      commitment: 'C',
      last_known_chad: { x: 0, y: 2 },
      seen_chad: [{ x: 0, y: 2 }],
    };

    let s = createSession({ sessionId: 10, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');

    // Turn 0: visible at A
    s = { ...s, chad_x: 0, chad_y: 2 };
    s = requestPing(s, 'D', 'N');
    s = setChadCommand(s, 'D', 'STAY');
    const o1 = stepAfterDispatcherAction(s, secret0);

    // Turn 1: visible at B
    let s2 = { ...o1.session, chad_x: 1, chad_y: 2, turn_step: 'command', pending_chad_cmd: 'STAY' };
    const o2 = stepAfterDispatcherAction(s2, o1.secret);

    // Turn 2: visible at C
    let s3 = { ...o2.session, chad_x: 2, chad_y: 2, turn_step: 'command', pending_chad_cmd: 'STAY' };
    const o3 = stepAfterDispatcherAction(s3, o2.secret);

    expect(o3.secret.last_known_chad).toEqual({ x: 0, y: 2 });
  });

  test('when Chad hides, assassin can move multiple steps and cannot stand still (unless trapped)', () => {
    let s = createSession({ sessionId: 11, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = { ...s, chad_x: 1, chad_y: 3 };
    s = requestPing(s, 'D', 'N');
    // Bypass availability; ensure hidden turn.
    s = { ...s, pending_chad_cmd: 'HIDE' };

    const secret = {
      assassin: { x: 9, y: 9 },
      commitment: 'C',
      last_known_chad: { x: 0, y: 2 },
      seen_chad: [{ x: 0, y: 2 }],
    };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.secret.assassin.x !== 9 || out.secret.assassin.y !== 9).toBe(true);
  });

  test('Chad cannot stay hidden for more than 2 consecutive turns', () => {
    let s = createSession({ sessionId: 12, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    // Place Chad near a hide tile in Grand Hall and allow command step.
    s = { ...s, chad_x: 3, chad_y: 9, turn_step: 'command' };
    // Force hide streak to 2 and attempt HIDE again.
    s = { ...s, chad_hide_streak: 2, pending_chad_cmd: 'HIDE' };

    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 3, y: 9 }, seen_chad: [{ x: 3, y: 9 }] };
    const out = stepAfterDispatcherAction(s, secret);
    expect(out.session.chad_hidden).toBe(false);
    expect(out.session.log.join('\n')).toMatch(/can't stay hidden any longer/i);
  });

  test('Chad can walk inside the garden to reposition', () => {
    const secret = { assassin: { x: 9, y: 9 }, commitment: 'C', last_known_chad: { x: 0, y: 0 }, seen_chad: [{ x: 0, y: 0 }] };
    let s = createSession({ sessionId: 13, mode: 'single', dispatcher: 'D', assassin: 'A' });
    s = commitLocation(s, 'A');
    s = { ...s, chad_x: 0, chad_y: 1 }; // garden left
    s = requestPing(s, 'D', 'N');
    // WALK_E should keep him in the garden.
    s = { ...s, pending_chad_cmd: 'WALK_E' };
    const out = stepAfterDispatcherAction(s, secret);
    expect(getRoomCodeAt(out.session.chad_x as number, out.session.chad_y as number)).toBe('G');
  });
});
