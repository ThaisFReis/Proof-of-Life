import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCircuitArtifactEntry,
  extractNoirAbiPublicLayout,
  parseNoirSourcePublicLayout,
} from './zk_artifacts_lib';

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('zk artifacts pipeline (layout + reproducibility)', () => {
  test('extracts public layout from compiled Noir JSON (ping_distance)', () => {
    const compiled = readJson(path.join(import.meta.dir, '../circuits/ping_distance/target/ping_distance.json'));
    const layout = extractNoirAbiPublicLayout(compiled);
    expect(layout.publicInputs).toEqual(['tower_x', 'tower_y', 'session_id', 'turn']);
    expect(layout.publicOutputs).toEqual(['return_value[0]', 'return_value[1]']);
  });

  test('parses public layout from Noir source (turn_status)', () => {
    const noir = fs.readFileSync(path.join(import.meta.dir, '../circuits/turn_status/src/main.nr'), 'utf8');
    const layout = parseNoirSourcePublicLayout(noir);
    expect(layout.publicInputs).toEqual(['cx', 'cy', 'session_id', 'turn']);
    expect(layout.publicOutputs).toEqual(['return_value[0]', 'return_value[1]']);
  });

  test('layout matches compiled artifacts (turn_status)', () => {
    const repoRoot = path.join(import.meta.dir, '..');
    const entry = buildCircuitArtifactEntry({
      repoRoot,
      circuitsDir: path.join(repoRoot, 'circuits'),
      name: 'turn_status',
    });
    expect(entry.layoutOk).toBe(true);
    expect(entry.problems.join('\n')).not.toContain('public input ordering mismatch');
  });

  test('artifact entries use repo-relative paths (no absolute /home leaks)', () => {
    const repoRoot = path.join(import.meta.dir, '..');
    const entry = buildCircuitArtifactEntry({
      repoRoot,
      circuitsDir: path.join(repoRoot, 'circuits'),
      name: 'ping_distance',
    });
    expect(entry.paths.compiledJson).toMatch(/^circuits\/ping_distance\//);
    expect(entry.paths.compiledJson).not.toContain('/home/');
  });
});
