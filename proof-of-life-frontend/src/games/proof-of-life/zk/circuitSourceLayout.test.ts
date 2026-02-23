import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

type NoirSig = {
  pubInputs: string[];
  pubOutputCount: number;
};

function parseNoirMainSignature(noir: string): NoirSig {
  // We only need stable extraction of `name: pub Field` parameters, in order.
  const pubInputs: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*pub\s+Field/g;
  for (;;) {
    const m = re.exec(noir);
    if (!m) break;
    pubInputs.push(m[1] ?? '');
  }

  // Output can be `pub Field` or `pub [Field; N]` (we use N=2 in v3).
  let pubOutputCount = 0;
  if (/fn\s+main[\s\S]*?\)\s*->\s*pub\s+Field\b/m.test(noir)) {
    pubOutputCount = 1;
  } else {
    const m = /fn\s+main[\s\S]*?\)\s*->\s*pub\s*\[\s*Field\s*;\s*(\d+)\s*\]/m.exec(noir);
    if (m?.[1]) pubOutputCount = Number(m[1]);
  }
  return { pubInputs, pubOutputCount };
}

function readCircuitMain(circuitName: string): string {
  const circuitsDir = path.join(import.meta.dir, '../../../../../circuits');
  const p = path.join(circuitsDir, circuitName, 'src', 'main.nr');
  return fs.readFileSync(p, 'utf8');
}

describe('Noir circuit source layout (v3 public field ordering)', () => {
  test('ping_distance pub inputs are (tower_x, tower_y, session_id, turn) and has 2 pub outputs', () => {
    const noir = readCircuitMain('ping_distance');
    const sig = parseNoirMainSignature(noir);
    expect(sig.pubInputs).toEqual(['tower_x', 'tower_y', 'session_id', 'turn']);
    expect(sig.pubOutputCount).toBe(2);
  });

  test('turn_status pub inputs are (cx, cy, session_id, turn) and has 2 pub outputs', () => {
    const noir = readCircuitMain('turn_status');
    const sig = parseNoirMainSignature(noir);
    expect(sig.pubInputs).toEqual(['cx', 'cy', 'session_id', 'turn']);
    expect(sig.pubOutputCount).toBe(2);
  });

  test('move_proof pub inputs are (session_id, turn) and has 2 pub outputs', () => {
    const noir = readCircuitMain('move_proof');
    const sig = parseNoirMainSignature(noir);
    expect(sig.pubInputs).toEqual(['session_id', 'turn']);
    expect(sig.pubOutputCount).toBe(2);
  });
});
