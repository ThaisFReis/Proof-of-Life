#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Wire UltraHonk verifiers into proof-of-life contract.
 *
 * This script can:
 * 1) Deploy three verifier contracts (one per circuit VK), and
 * 2) Call proof-of-life `set_verifiers(ping_v, turn_v, move_v)`, then
 * 3) Read back `get_verifiers` for confirmation.
 *
 * Usage:
 *   bun run scripts/zk_wire_verifiers.ts \
 *     --admin-secret S... \
 *     --game-id C... \
 *     --network testnet
 *
 * Optional:
 *   --skip-deploy            Use existing verifier IDs (no deploy step)
 *   --ping-id C...           Reuse ping verifier ID (skip ping deploy)
 *   --turn-id C...           Reuse turn_status verifier ID (skip turn deploy)
 *   --move-id C...           Reuse move verifier ID (skip move deploy)
 *   --ping-id C...
 *   --turn-id C...
 *   --move-id C...
 *   --verifier-wasm <path>   Default: contracts/ultrahonk-verifier/target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm
 *   --vk-ping <path>         Default: circuits/ping_distance/target/vk
 *   --vk-turn <path>         Default: circuits/turn_status/target/vk
 *   --vk-move <path>         Default: circuits/move_proof/target/vk
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnvFile, getEnvValue } from './utils/env';

type Args = {
  adminSecret?: string;
  gameId: string;
  network: string;
  skipDeploy: boolean;
  verifierWasm: string;
  vkPing: string;
  vkTurn: string;
  vkMove: string;
  pingId?: string;
  turnId?: string;
  moveId?: string;
};

function usageAndExit(code = 0): never {
  console.log(`
Usage:
  bun run scripts/zk_wire_verifiers.ts --admin-secret S... --game-id C... [options]

Options:
  --network <name>          Stellar network alias (default: testnet)
  --skip-deploy             Use existing verifier IDs instead of deploying
  --ping-id <id>            Existing ping verifier ID (required with --skip-deploy; optional for partial reuse)
  --turn-id <id>            Existing turn_status verifier ID (required with --skip-deploy; optional for partial reuse)
  --move-id <id>            Existing move verifier ID (required with --skip-deploy; optional for partial reuse)
  --verifier-wasm <path>    Verifier WASM path
  --vk-ping <path>          VK file path for ping_distance
  --vk-turn <path>          VK file path for turn_status
  --vk-move <path>          VK file path for move_proof

Examples:
  bun run scripts/zk_wire_verifiers.ts --admin-secret S... --game-id C...
  bun run scripts/zk_wire_verifiers.ts --admin-secret S... --game-id C... --skip-deploy --ping-id C1 --turn-id C2 --move-id C3
`);
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const defaults = {
    network: 'testnet',
    verifierWasm: 'contracts/ultrahonk-verifier/target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm',
    vkPing: 'circuits/ping_distance/target/vk',
    vkTurn: 'circuits/turn_status/target/vk',
    vkMove: 'circuits/move_proof/target/vk',
  };

  let adminSecret = '';
  let gameId = '';
  let network = defaults.network;
  let skipDeploy = false;
  let verifierWasm = defaults.verifierWasm;
  let vkPing = defaults.vkPing;
  let vkTurn = defaults.vkTurn;
  let vkMove = defaults.vkMove;
  let pingId: string | undefined;
  let turnId: string | undefined;
  let moveId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--help' || a === '-h') usageAndExit(0);
    if (a === '--skip-deploy') {
      skipDeploy = true;
      continue;
    }
    if (a === '--admin-secret') {
      if (!v) throw new Error('missing value for --admin-secret');
      adminSecret = v;
      i++;
      continue;
    }
    if (a === '--game-id') {
      if (!v) throw new Error('missing value for --game-id');
      gameId = v;
      i++;
      continue;
    }
    if (a === '--network') {
      if (!v) throw new Error('missing value for --network');
      network = v;
      i++;
      continue;
    }
    if (a === '--verifier-wasm') {
      if (!v) throw new Error('missing value for --verifier-wasm');
      verifierWasm = v;
      i++;
      continue;
    }
    if (a === '--vk-ping') {
      if (!v) throw new Error('missing value for --vk-ping');
      vkPing = v;
      i++;
      continue;
    }
    if (a === '--vk-turn') {
      if (!v) throw new Error('missing value for --vk-turn');
      vkTurn = v;
      i++;
      continue;
    }
    if (a === '--vk-move') {
      if (!v) throw new Error('missing value for --vk-move');
      vkMove = v;
      i++;
      continue;
    }
    if (a === '--ping-id') {
      if (!v) throw new Error('missing value for --ping-id');
      pingId = v;
      i++;
      continue;
    }
    if (a === '--turn-id') {
      if (!v) throw new Error('missing value for --turn-id');
      turnId = v;
      i++;
      continue;
    }
    if (a === '--move-id') {
      if (!v) throw new Error('missing value for --move-id');
      moveId = v;
      i++;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }

  return {
    adminSecret,
    gameId,
    network,
    skipDeploy,
    verifierWasm,
    vkPing,
    vkTurn,
    vkMove,
    pingId,
    turnId,
    moveId,
  };
}

function run(cmd: string, args: string[]): string {
  const p = spawnSync(cmd, args, { encoding: 'utf8' });
  if (p.status !== 0) {
    const out = (p.stdout ?? '').trim();
    const err = (p.stderr ?? '').trim();
    throw new Error(`${cmd} ${args.join(' ')}\n${out}\n${err}`.trim());
  }
  return (p.stdout ?? '').trim();
}

function isSubmissionTimeoutError(err: unknown): boolean {
  const msg = String(err ?? '');
  return /transaction submission timeout/i.test(msg);
}

function deployVerifierWithRetry(
  label: string,
  adminSecret: string,
  network: string,
  verifierWasm: string,
  vkPath: string
): string {
  // The verifier expects [32-byte vk_hash] + [VK binary].
  // Read vk_hash from the sibling file and prepend it.
  const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
  const { dirname, join } = require('node:path');
  const vkHashPath = join(dirname(vkPath), 'vk_hash');
  if (!existsSync(vkHashPath)) {
    throw new Error(`vk_hash file not found at ${vkHashPath}. Run "bb write_vk -t evm-no-zk" to generate it.`);
  }
  const vkHash: Buffer = readFileSync(vkHashPath);
  const vkData: Buffer = readFileSync(vkPath);
  const combined = Buffer.concat([vkHash, vkData]);
  const tmpPath = `${vkPath}_with_hash`;
  writeFileSync(tmpPath, combined);
  console.log(`    📦 Created ${tmpPath} (${combined.length} bytes = ${vkHash.length} hash + ${vkData.length} vk)`);

  const maxAttempts = 3;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const out = run('stellar', [
          'contract', 'deploy',
          '--wasm', verifierWasm,
          '--source-account', adminSecret,
          '--network', network,
          '--',
          '--vk_bytes-file-path', tmpPath,
        ]);
        return parseContractId(out);
      } catch (e) {
        if (!isSubmissionTimeoutError(e) || attempt === maxAttempts) throw e;
        console.log(`    ⚠️  ${label} deploy timeout (attempt ${attempt}/${maxAttempts}), retrying...`);
      }
    }
    throw new Error(`${label} deployment failed after retries`);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
  }
}

function requireFile(pathLike: string, label: string): string {
  const abs = resolve(pathLike);
  if (!existsSync(abs)) throw new Error(`${label} not found: ${abs}`);
  return abs;
}

function parseContractId(output: string): string {
  const lines = output.split('\n').map((x) => x.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  if (!/^C[A-Z2-7]{55}$/.test(last)) {
    throw new Error(`could not parse contract id from output:\n${output}`);
  }
  return last;
}

async function readDefaultsFromEnv(): Promise<Partial<Args>> {
  const env = await readEnvFile('.env');
  const deployJsonExists = existsSync('deployment.json');
  let gameId = getEnvValue(env, 'VITE_PROOF_OF_LIFE_CONTRACT_ID') ?? '';

  if (deployJsonExists) {
    try {
      const dep = await Bun.file('deployment.json').json() as any;
      if (!gameId) gameId = dep?.contracts?.['proof-of-life'] ?? dep?.contracts?.proofOfLife ?? '';
    } catch {
      // ignore parse issues; caller still can pass --game-id
    }
  }

  const adminSecret = getEnvValue(env, 'VITE_DEV_ADMIN_SECRET');
  return { gameId, adminSecret };
}

async function main() {
  try {
    const defaults = await readDefaultsFromEnv();
    const a = parseArgs(process.argv.slice(2));
    const gameId = a.gameId || defaults.gameId || '';
    const adminSecret = a.adminSecret || defaults.adminSecret;
    if (!adminSecret) throw new Error('missing --admin-secret');
    if (!gameId) throw new Error('missing --game-id (or VITE_PROOF_OF_LIFE_CONTRACT_ID/deployment.json)');

    const verifierWasm = requireFile(a.verifierWasm, 'verifier wasm');
    const vkPing = requireFile(a.vkPing, 'vk ping');
    const vkTurn = requireFile(a.vkTurn, 'vk turn');
    const vkMove = requireFile(a.vkMove, 'vk move');

    let pingId = a.pingId;
    let turnId = a.turnId;
    let moveId = a.moveId;

    if (!a.skipDeploy) {
      console.log('🚀 Deploying UltraHonk verifiers...');

      if (pingId) {
        console.log(`  - ping_distance verifier: reusing ${pingId}`);
      } else {
        console.log('  - ping_distance verifier');
        pingId = deployVerifierWithRetry('ping_distance', adminSecret, a.network, verifierWasm, vkPing);
        console.log(`    ✅ ${pingId}`);
      }

      if (turnId) {
        console.log(`  - turn_status verifier: reusing ${turnId}`);
      } else {
        console.log('  - turn_status verifier');
        turnId = deployVerifierWithRetry('turn_status', adminSecret, a.network, verifierWasm, vkTurn);
        console.log(`    ✅ ${turnId}`);
      }

      if (moveId) {
        console.log(`  - move_proof verifier: reusing ${moveId}`);
      } else {
        console.log('  - move_proof verifier');
        moveId = deployVerifierWithRetry('move_proof', adminSecret, a.network, verifierWasm, vkMove);
        console.log(`    ✅ ${moveId}`);
      }
    } else {
      if (!pingId || !turnId || !moveId) {
        throw new Error('--skip-deploy requires --ping-id, --turn-id and --move-id');
      }
      console.log('ℹ️  Using existing verifier IDs (skip deploy).');
    }

    console.log('\n🔗 Wiring verifiers into proof-of-life...');
    run('stellar', [
      'contract', 'invoke',
      '--id', gameId,
      '--source-account', adminSecret,
      '--network', a.network,
      '--send', 'yes',
      '--',
      'set_verifiers',
      '--ping_v', pingId!,
      '--turn_v', turnId!,
      '--move_v', moveId!,
    ]);
    console.log('✅ set_verifiers sent');

    const got = run('stellar', [
      'contract', 'invoke',
      '--id', gameId,
      '--source-account', adminSecret,
      '--network', a.network,
      '--',
      'get_verifiers',
    ]);
    console.log(`✅ get_verifiers: ${got}`);

    const out = {
      network: a.network,
      gameId,
      verifiers: {
        ping: pingId!,
        turnStatus: turnId!,
        move: moveId!,
      },
      getVerifiersRaw: got,
      updatedAt: new Date().toISOString(),
    };
    await writeFile('deployment.verifiers.json', JSON.stringify(out, null, 2) + '\n');
    console.log('📝 wrote deployment.verifiers.json');
  } catch (e) {
    console.error(`❌ ${String(e)}`);
    usageAndExit(1);
  }
}

void main();
