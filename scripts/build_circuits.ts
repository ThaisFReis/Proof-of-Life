#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Proof Artifact Pipeline (Build + Reproducibility)
 *
 * Goals:
 * - compile circuits when Noir is available
 * - (optionally) generate UltraHonk proof/vk artifacts when `bb` is available
 * - package artifacts into `zk-artifacts/` with stable, repo-relative paths
 * - emit a manifest with checksums + expected/actual public field layout
 *
 * Usage:
 *   bun run zk:build
 *
 * Flags:
 *   --no-compile     Skip `nargo compile` even if nargo is installed
 *   --no-bb          Skip `scripts/build_ultrahonk.sh` even if bb is installed
 *   --allow-stale    Do not fail on layout mismatch (still records problems in manifest)
 *   --out <dir>      Output directory (default: zk-artifacts)
 */

import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import fs from 'node:fs';
import path from 'node:path';
import { buildCircuitArtifactEntry, sha256Hex } from './zk_artifacts_lib';

const exec = promisify(_exec);

const CIRCUITS = ['ping_distance', 'turn_status', 'move_proof'] as const;

type Args = {
  noCompile: boolean;
  noBb: boolean;
  allowStale: boolean;
  outDir: string;
};

function parseArgs(argv: string[]): Args {
  let noCompile = false;
  let noBb = false;
  let allowStale = false;
  let outDir = 'zk-artifacts';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-compile') noCompile = true;
    else if (a === '--no-bb') noBb = true;
    else if (a === '--allow-stale') allowStale = true;
    else if (a === '--out') {
      const v = argv[i + 1];
      if (!v) throw new Error('missing value for --out');
      outDir = v;
      i++;
    } else if (a?.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    }
  }

  return { noCompile, noBb, allowStale, outDir };
}

async function which(cmd: string): Promise<boolean> {
  try {
    await exec(`command -v ${cmd}`, { shell: '/usr/bin/zsh', env: BASE_ENV });
    return true;
  } catch {
    return false;
  }
}

async function tryVersion(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await exec(`${cmd} --version`, { shell: '/usr/bin/zsh', env: BASE_ENV });
    return String(stdout).trim() || null;
  } catch {
    return null;
  }
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeRel(p: string): string {
  return p.split(path.sep).join('/');
}

function augmentPathForZkTools(envIn: Record<string, string | undefined>): Record<string, string | undefined> {
  const home = envIn.HOME;
  const p0 = envIn.PATH ?? '';
  if (!home) return envIn;
  const extra = [`${home}/.nargo/bin`, `${home}/.bb`, `${home}/.bb/bin`].join(':');
  return { ...envIn, PATH: `${extra}:${p0}` };
}

const BASE_ENV = augmentPathForZkTools(process.env as Record<string, string | undefined>);

function copyIfExists(srcAbs: string, dstAbs: string): { copied: boolean; sha256?: string; bytes?: number } {
  if (!fs.existsSync(srcAbs)) return { copied: false };
  ensureDir(path.dirname(dstAbs));
  const buf = fs.readFileSync(srcAbs);
  fs.writeFileSync(dstAbs, buf);
  return { copied: true, sha256: sha256Hex(buf), bytes: buf.length };
}

async function compileCircuits(repoRoot: string) {
  // Nargo uses home/XDG dirs for git dependency caches; in restricted environments
  // we must ensure they point to a writable location inside the repo.
  const zkHome = path.join(repoRoot, '.zk-home');
  const cacheDir = path.join(zkHome, 'cache');
  const configDir = path.join(zkHome, 'config');
  const dataDir = path.join(zkHome, 'data');
  const nargoHome = path.join(zkHome, 'nargo');
  const homeDir = path.join(zkHome, 'home');
  ensureDir(cacheDir);
  ensureDir(configDir);
  ensureDir(dataDir);
  ensureDir(nargoHome);
  ensureDir(homeDir);

  const env = {
    ...BASE_ENV,
    HOME: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    NARGO_HOME: nargoHome,
  };

  for (const name of CIRCUITS) {
    const cwd = path.join(repoRoot, 'circuits', name);
    console.log(`\n[zk] nargo compile ${name}`);
    await exec('nargo compile', { cwd, shell: '/usr/bin/zsh', env });
  }
}

async function buildUltrahonk(repoRoot: string) {
  console.log('\n[zk] generating UltraHonk proof + vk artifacts via scripts/build_ultrahonk.sh');
  const zkHome = path.join(repoRoot, '.zk-home');
  const cacheDir = path.join(zkHome, 'cache');
  const configDir = path.join(zkHome, 'config');
  const dataDir = path.join(zkHome, 'data');
  const nargoHome = path.join(zkHome, 'nargo');
  const homeDir = path.join(zkHome, 'home');
  ensureDir(cacheDir);
  ensureDir(configDir);
  ensureDir(dataDir);
  ensureDir(nargoHome);
  ensureDir(homeDir);

  const env = {
    ...BASE_ENV,
    HOME: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    NARGO_HOME: nargoHome,
  };
  await exec('bash scripts/build_ultrahonk.sh', { cwd: repoRoot, shell: '/usr/bin/zsh', env });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(import.meta.dir, '..');
  const circuitsDir = path.join(repoRoot, 'circuits');
  const outAbs = path.join(repoRoot, args.outDir);

  const hasNargo = await which('nargo');
  const hasBb = await which('bb');

  const toolVersions = {
    bun: `bun ${Bun.version}`,
    node: `node ${process.versions.node}`,
    nargo: (await tryVersion('nargo')) ?? null,
    bb: (await tryVersion('bb')) ?? null,
  };

  console.log('[zk] artifact pipeline');
  console.log(`[zk] repoRoot=${repoRoot}`);
  console.log(`[zk] out=${outAbs}`);
  console.log(`[zk] tools=${JSON.stringify(toolVersions)}`);

  if (!args.noCompile) {
    if (!hasNargo) {
      console.warn('[zk] warning: nargo not found; skipping compile (use ./scripts/install_noir.sh)');
    } else {
      await compileCircuits(repoRoot);
    }
  }

  if (!args.noBb) {
    if (!hasBb) {
      console.warn('[zk] warning: bb not found; skipping UltraHonk artifact build (vk/proof may be stale)');
    } else {
      await buildUltrahonk(repoRoot);
    }
  }

  ensureDir(outAbs);

  const manifestCircuits: any[] = [];
  let hasProblems = false;

  for (const name of CIRCUITS) {
    const entry = buildCircuitArtifactEntry({ repoRoot, circuitsDir, name });
    if (!entry.layoutOk) hasProblems = true;

    const pkgDir = path.join(outAbs, name);
    ensureDir(pkgDir);

    // Copy a minimal, reproducible bundle for each circuit.
    // We keep filenames stable (no absolute paths) so the manifest is shareable.
    const files: Record<string, { sha256: string; bytes: number } | null> = {};

    const rel = (p: string) => normalizeRel(path.relative(repoRoot, p));

    const srcMainAbs = path.join(repoRoot, entry.paths.sourceMain);
    const compiledAbs = entry.paths.compiledJson ? path.join(repoRoot, entry.paths.compiledJson) : null;
    const publicInputsAbs = entry.paths.publicInputsBin ? path.join(repoRoot, entry.paths.publicInputsBin) : null;
    const vkAbs = entry.paths.vk ? path.join(repoRoot, entry.paths.vk) : null;
    const proofAbs = entry.paths.proof ? path.join(repoRoot, entry.paths.proof) : null;

    const extras = [
      compiledAbs ? [compiledAbs, path.join(pkgDir, `${name}.json`)] : null,
      [srcMainAbs, path.join(pkgDir, 'main.nr')],
      publicInputsAbs ? [publicInputsAbs, path.join(pkgDir, 'public_inputs')] : null,
      vkAbs ? [vkAbs, path.join(pkgDir, 'vk')] : null,
      proofAbs ? [proofAbs, path.join(pkgDir, 'proof')] : null,
      // common sidecar fields/json (if present)
      [path.join(repoRoot, 'circuits', name, 'target', `${name}.gz`), path.join(pkgDir, `${name}.gz`)],
      [path.join(repoRoot, 'circuits', name, 'target', 'vk_fields.json'), path.join(pkgDir, 'vk_fields.json')],
      [path.join(repoRoot, 'circuits', name, 'target', 'proof_fields.json'), path.join(pkgDir, 'proof_fields.json')],
      [path.join(repoRoot, 'circuits', name, 'target', 'public_inputs_fields.json'), path.join(pkgDir, 'public_inputs_fields.json')],
      [path.join(repoRoot, 'circuits', name, 'Prover.toml'), path.join(pkgDir, 'Prover.toml')],
      [path.join(repoRoot, 'circuits', name, 'Nargo.toml'), path.join(pkgDir, 'Nargo.toml')],
    ].filter(Boolean) as Array<[string, string]>;

    for (const [src, dst] of extras) {
      const r = copyIfExists(src, dst);
      if (r.copied) files[rel(dst)] = { sha256: r.sha256!, bytes: r.bytes! };
    }

    manifestCircuits.push({
      name,
      layout_ok: entry.layoutOk,
      problems: entry.problems,
      public_inputs_expected: entry.layoutExpected.publicInputs,
      public_outputs_expected: entry.layoutExpected.publicOutputs,
      public_inputs_actual: entry.layoutActual?.publicInputs ?? null,
      public_outputs_actual: entry.layoutActual?.publicOutputs ?? null,
      expected_public_field_count: entry.expectedPublicFieldCount,
      actual_public_field_count: entry.actualPublicFieldCount,
      paths: entry.paths, // repo-relative inputs
      packaged_files: files, // artifact-relative outputs + checksums
    });
  }

  const manifest = {
    version: '2.0.0',
    generated_utc: new Date().toISOString(),
    tool_versions: toolVersions,
    circuits: manifestCircuits,
  };

  const manifestPath = path.join(outAbs, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n[zk] wrote ${normalizeRel(path.relative(repoRoot, manifestPath))}`);

  if (hasProblems && !args.allowStale) {
    console.error('\n[zk] error: circuit artifact/layout problems detected.');
    console.error('[zk] fix by regenerating circuit artifacts (nargo+bb), then re-run.');
    console.error('[zk] or re-run with --allow-stale to write a manifest anyway.');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('error:', e?.message ?? e);
  process.exit(1);
});
