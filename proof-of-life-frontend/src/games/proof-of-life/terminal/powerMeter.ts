export type PowerLevel = 'ok' | 'warn' | 'crit';

export function getPowerLevel(battery: number): PowerLevel {
  if (battery <= 20) return 'crit';
  if (battery <= 50) return 'warn';
  return 'ok';
}

export function formatPowerMeter(battery: number, width = 10): {
  battery: number;
  percent: number;
  level: PowerLevel;
  filled: number;
  text: string;
} {
  const clamped = Math.max(0, Math.min(100, Math.floor(battery)));
  const filled = Math.max(0, Math.min(width, Math.floor((clamped / 100) * width)));
  const bar = `${'|'.repeat(filled)}${'.'.repeat(width - filled)}`;
  const text = `POWER: [${bar}] ${clamped}%`;
  return {
    battery: clamped,
    percent: clamped,
    level: getPowerLevel(clamped),
    filled,
    text,
  };
}

