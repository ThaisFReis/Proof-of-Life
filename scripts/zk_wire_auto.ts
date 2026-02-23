#!/usr/bin/env bun
/* eslint-disable no-console */

import { spawnSync } from 'node:child_process';
import { readEnvFile, getEnvValue } from './utils/env';

function run(cmd: string, args: string[]): void {
  const p = spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' });
  if (p.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with code ${p.status ?? 1}`);
  }
}

async function main() {
  const env = await readEnvFile('.env');
  const adminSecret = getEnvValue(env, 'VITE_DEV_ADMIN_SECRET') ?? '';
  const gameId = getEnvValue(env, 'VITE_PROOF_OF_LIFE_CONTRACT_ID') ?? '';

  if (!adminSecret) {
    throw new Error('VITE_DEV_ADMIN_SECRET missing in .env (run deploy first with the updated deploy script).');
  }
  if (!gameId) {
    throw new Error('VITE_PROOF_OF_LIFE_CONTRACT_ID missing in .env.');
  }

  console.log('🔌 Auto-wiring UltraHonk verifiers from .env');
  console.log(`   game=${gameId}`);
  run('bun', ['run', 'scripts/zk_wire_verifiers.ts', '--admin-secret', adminSecret, '--game-id', gameId, '--network', 'testnet']);
}

main().catch((e) => {
  console.error(`❌ zk:wire:auto failed: ${String(e)}`);
  process.exit(1);
});

