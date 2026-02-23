import { describe, expect, test } from 'bun:test';
import {
  encodeMovePublicFieldsV3,
  encodePingPublicFieldsV3,
  encodeTurnStatusPublicFieldsV3,
  ZK_INPUTS_VERSION,
} from './encoding';

describe('zk/encoding', () => {
  test('has stable version', () => {
    expect(ZK_INPUTS_VERSION).toBe(3);
  });

  test('ping public field ordering is [commitment, tower_x, tower_y, session_id, turn, d2]', () => {
    const out = encodePingPublicFieldsV3({
      commitment: 11n,
      towerX: 22n,
      towerY: 33n,
      sessionId: 44n,
      turn: 55n,
      d2: 66n,
    });
    expect(out).toEqual([11n, 22n, 33n, 44n, 55n, 66n]);
  });

  test('turn status public field ordering is [commitment, cx, cy, session_id, turn, d2_chad]', () => {
    const out = encodeTurnStatusPublicFieldsV3({
      commitment: 99n,
      chadX: 5n,
      chadY: 6n,
      sessionId: 7n,
      turn: 8n,
      d2Chad: 9n,
    });
    expect(out).toEqual([99n, 5n, 6n, 7n, 8n, 9n]);
  });

  test('move public field ordering is [commitment_old, commitment_new, session_id, turn]', () => {
    const out = encodeMovePublicFieldsV3({
      commitmentOld: 1n,
      commitmentNew: 2n,
      sessionId: 3n,
      turn: 4n,
    });
    expect(out).toEqual([1n, 2n, 3n, 4n]);
  });
});
