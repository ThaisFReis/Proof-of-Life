import { describe, expect, test } from 'bun:test';
import { formatPowerMeter, getPowerLevel } from './powerMeter';

describe('powerMeter', () => {
  test('formats full battery', () => {
    const out = formatPowerMeter(100);
    expect(out.text).toBe('POWER: [||||||||||] 100%');
    expect(out.level).toBe('ok');
  });

  test('formats half battery', () => {
    const out = formatPowerMeter(50);
    expect(out.text).toBe('POWER: [|||||.....] 50%');
    expect(out.level).toBe('warn');
  });

  test('formats low battery', () => {
    const out = formatPowerMeter(10);
    expect(out.text).toBe('POWER: [|.........] 10%');
    expect(out.level).toBe('crit');
  });

  test('clamps battery into [0,100]', () => {
    expect(formatPowerMeter(-5).text).toBe('POWER: [..........] 0%');
    expect(formatPowerMeter(999).text).toBe('POWER: [||||||||||] 100%');
  });

  test('power level thresholds', () => {
    expect(getPowerLevel(100)).toBe('ok');
    expect(getPowerLevel(51)).toBe('ok');
    expect(getPowerLevel(50)).toBe('warn');
    expect(getPowerLevel(21)).toBe('warn');
    expect(getPowerLevel(20)).toBe('crit');
    expect(getPowerLevel(0)).toBe('crit');
  });
});

