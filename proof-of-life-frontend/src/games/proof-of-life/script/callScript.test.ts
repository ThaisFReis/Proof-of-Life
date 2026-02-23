import { describe, expect, test } from 'bun:test';
import { getBootSequence, getIntroCallSequence } from './callScript';

describe('script/callScript', () => {
  test('boot sequence starts with SYSTEM BOOT', () => {
    const boot = getBootSequence();
    expect(boot[0].line).toMatch(/SYSTEM BOOT/);
  });

  test('intro has 911 opener', () => {
    const intro = getIntroCallSequence().map((x) => x.line).join('\n');
    expect(intro).toMatch(/9-1-1/);
    expect(intro).toMatch(/what is your emergency/i);
  });
});

