#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Local Noir+bb prover daemon for Proof of Life.
 *
 * Frontend calls this service to generate UltraHonk proofs + public inputs fields.
 * This keeps proving out of the browser while still verifying on-chain.
 *
 * Run:
 *   bun run zk:prover
 *
 * Env:
 *   PORT (default 8788)
 *   PROVER_CORS_ORIGIN (default "*")
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';

const exec = promisify(_exec);

type CircuitName = 'ping_distance' | 'turn_status' | 'move_proof';

type PingReq = {
  x: number;
  y: number;
  salt: number;
  tower_x: number;
  tower_y: number;
  session_id: number;
  turn: number;
};

type StatusReq = {
  x: number;
  y: number;
  salt: number;
  cx: number;
  cy: number;
  session_id: number;
  turn: number;
};

type MoveReq = {
  x_old: number;
  y_old: number;
  salt_old: number;
  x_new: number;
  y_new: number;
  salt_new: number;
  session_id: number;
  turn: number;
};

type ProveResponse = {
  circuit: CircuitName;
  proof_hex: string; // raw proof bytes hex (no 0x)
  public_inputs_fields: string[]; // array of 0x-prefixed 32-byte fields (big-endian)
};

function repoRoot(): string {
  return path.join(import.meta.dir, '..');
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function mkZkEnv(): Record<string, string | undefined> {
  const root = repoRoot();
  const zkHome = path.join(root, '.zk-home');
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

  // Use the REAL home (before override) to locate bb and nargo binaries
  const realHome = process.env.HOME ?? '';
  const p0 = process.env.PATH ?? '';
  // ~/.bb/bb (3.x nightly) must come before ~/.bb/bin/bb (old 0.87.0 leftover)
  const extra = [`${realHome}/.nargo/bin`, `${realHome}/.bb`, `${realHome}/.bb/bin`].join(':');

  return {
    ...(process.env as Record<string, string | undefined>),
    HOME: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    NARGO_HOME: nargoHome,
    PATH: `${extra}:${p0}`,
  };
}

function circuitDir(name: CircuitName): string {
  return path.join(repoRoot(), 'circuits', name);
}

let checkedToolchain = false;
async function ensureCompatibleToolchain(env: Record<string, string | undefined>): Promise<void> {
  if (checkedToolchain) return;
  const { stdout: nargoVRaw } = await exec('nargo --version', { shell: '/usr/bin/bash', env });
  const { stdout: bbVRaw } = await exec('bb --version', { shell: '/usr/bin/bash', env });
  const nargoV = String(nargoVRaw ?? '').trim();
  const bbV = String(bbVRaw ?? '').trim();
  if (!nargoV.includes('nargo version = 1.0.0-beta.18')) {
    throw new Error(
      `incompatible nargo version for this prover pipeline: "${nargoV}". Expected 1.0.0-beta.18 (run: noirup --version 1.0.0-beta.18)`
    );
  }
  if (!bbV.startsWith('3.0.0')) {
    throw new Error(
      `incompatible bb version for this prover pipeline: "${bbV}". Expected 3.0.0-nightly (run: bbup -v 3.0.0-nightly.20260102)`
    );
  }
  checkedToolchain = true;
}

function proverTomlForCircuit(name: CircuitName, req: any): string {
  // Keep ordering stable for diff/debugging.
  switch (name) {
    case 'ping_distance': {
      const r = req as PingReq;
      return [
        `x = "${r.x}"`,
        `y = "${r.y}"`,
        `salt = "${r.salt}"`,
        `tower_x = "${r.tower_x}"`,
        `tower_y = "${r.tower_y}"`,
        `session_id = "${r.session_id}"`,
        `turn = "${r.turn}"`,
        '',
      ].join('\n');
    }
    case 'turn_status': {
      const r = req as StatusReq;
      return [
        `x = "${r.x}"`,
        `y = "${r.y}"`,
        `salt = "${r.salt}"`,
        `cx = "${r.cx}"`,
        `cy = "${r.cy}"`,
        `session_id = "${r.session_id}"`,
        `turn = "${r.turn}"`,
        '',
      ].join('\n');
    }
    case 'move_proof': {
      const r = req as MoveReq;
      return [
        `x_old = "${r.x_old}"`,
        `y_old = "${r.y_old}"`,
        `salt_old = "${r.salt_old}"`,
        `x_new = "${r.x_new}"`,
        `y_new = "${r.y_new}"`,
        `salt_new = "${r.salt_new}"`,
        `session_id = "${r.session_id}"`,
        `turn = "${r.turn}"`,
        '',
      ].join('\n');
    }
    default:
      throw new Error(`unknown circuit: ${name}`);
  }
}

async function proveCircuit(name: CircuitName, req: any): Promise<ProveResponse> {
  const cwd = circuitDir(name);
  const env = mkZkEnv();
  await ensureCompatibleToolchain(env);

  // 1) Write Prover.toml (nargo reads it)
  fs.writeFileSync(path.join(cwd, 'Prover.toml'), proverTomlForCircuit(name, req), 'utf8');

  // 2) Generate witness (.gz)
  await exec('nargo execute', { cwd, shell: '/usr/bin/bash', env });

  // 3) Prove (write to per-request output dir to avoid collisions)
  const outDir = path.join(cwd, 'target', 'prover-out', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  ensureDir(outDir);

  // Remove stale VK from target/ — bb v3.0.0 reads ./target/vk by default
  // and fails with "Length is too large" if it finds an incompatible file.
  try { fs.unlinkSync(path.join(cwd, 'target', 'vk')); } catch {}

  const json = path.join('target', `${name}.json`);
  const gz = path.join('target', `${name}.gz`);

  await exec(
    [
      'bb prove',
      `-b ${json}`,
      `-w ${gz}`,
      `-o ${outDir}`,
      '--verifier_target evm-no-zk',
      '--write_vk',
    ].join(' '),
    { cwd, shell: '/usr/bin/bash', env }
  );

  const proof = fs.readFileSync(path.join(outDir, 'proof'));

  // bb v3.0.0 outputs public_inputs as raw binary (32 bytes per field, big-endian).
  const piBuf = fs.readFileSync(path.join(outDir, 'public_inputs'));
  if (piBuf.length % 32 !== 0) {
    throw new Error(`public_inputs file size (${piBuf.length}) is not a multiple of 32`);
  }
  const publicInputsFields: string[] = [];
  for (let i = 0; i < piBuf.length; i += 32) {
    publicInputsFields.push('0x' + Buffer.from(piBuf.subarray(i, i + 32)).toString('hex'));
  }

  return {
    circuit: name,
    proof_hex: Buffer.from(proof).toString('hex'),
    public_inputs_fields: publicInputsFields as string[],
  };
}

// Serialize proving per circuit to avoid races on `Prover.toml` / `target/*.gz`.
const locks = new Map<CircuitName, Promise<void>>();
async function withCircuitLock<T>(name: CircuitName, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(name, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // best-effort cleanup
    if (locks.get(name) === next) locks.delete(name);
  }
}

function json(res: ResponseInit & { body?: any }) {
  return new Response(JSON.stringify(res.body ?? null), {
    status: res.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(res.headers ?? {}),
    },
  });
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

const PORT = Number(process.env.PORT ?? '8788') || 8788;
const CORS_ORIGIN = String(process.env.PROVER_CORS_ORIGIN ?? '*');

console.log(`[prover] starting on http://127.0.0.1:${PORT}`);

Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return json({ status: 200, headers: corsHeaders(CORS_ORIGIN), body: { ok: true } });
    if (req.method !== 'POST') return json({ status: 405, headers: corsHeaders(CORS_ORIGIN), body: { error: 'method not allowed' } });

    const readJson = async () => {
      try {
        return await req.json();
      } catch {
        return null;
      }
    };

    const body = await readJson();
    if (!body) return json({ status: 400, headers: corsHeaders(CORS_ORIGIN), body: { error: 'invalid json' } });

    try {
      if (url.pathname === '/prove/ping_distance') {
        const out = await withCircuitLock('ping_distance', () => proveCircuit('ping_distance', body as PingReq));
        return json({ status: 200, headers: corsHeaders(CORS_ORIGIN), body: out });
      }
      if (url.pathname === '/prove/turn_status') {
        const out = await withCircuitLock('turn_status', () => proveCircuit('turn_status', body as StatusReq));
        return json({ status: 200, headers: corsHeaders(CORS_ORIGIN), body: out });
      }
      if (url.pathname === '/prove/move_proof') {
        const out = await withCircuitLock('move_proof', () => proveCircuit('move_proof', body as MoveReq));
        return json({ status: 200, headers: corsHeaders(CORS_ORIGIN), body: out });
      }
      return json({ status: 404, headers: corsHeaders(CORS_ORIGIN), body: { error: 'not found' } });
    } catch (e) {
      return json({
        status: 500,
        headers: corsHeaders(CORS_ORIGIN),
        body: { error: String((e as any)?.message ?? e) },
      });
    }
  },
});
