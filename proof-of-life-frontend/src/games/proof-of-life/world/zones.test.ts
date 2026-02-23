import { describe, expect, test } from 'bun:test';
import { getRoomDescription } from './zones';

describe('world/zones', () => {
  test('returns a named zone when inside range', () => {
    const r = getRoomDescription(0, 0); // garden
    expect(r.label).toMatch(/Garden/i);
  });

  test('returns hallway as fallback', () => {
    const r = getRoomDescription(9, 9);
    expect(r.label.length).toBeGreaterThan(0);
  });
});
