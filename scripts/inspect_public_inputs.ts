#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Inspect an UltraHonk `public_inputs` binary blob.
 *
 * The UltraHonk Soroban verifier expects `public_inputs` as concatenated 32-byte fields (big-endian).
 * This tool prints each field as:
 * - index
 * - hex
 * - bigint
 * - u32 (if it fits)
 *
 * Usage:
 *   node scripts/inspect_public_inputs.ts <path/to/public_inputs>
 *
 * Example:
 *   node scripts/inspect_public_inputs.ts circuits/ping_distance/target/public_inputs
 */

import fs from 'node:fs';

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) + BigInt(b);
  return v;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function main() {
  const p = process.argv[2];
  if (!p) {
    console.error('error: missing file path');
    process.exit(2);
  }

  const buf = fs.readFileSync(p);
  if (buf.length % 32 !== 0) {
    console.error(`error: file length ${buf.length} is not a multiple of 32`);
    process.exit(2);
  }

  const n = buf.length / 32;
  console.log(`fields: ${n} (bytes=${buf.length})`);

  for (let i = 0; i < n; i++) {
    const slice = buf.subarray(i * 32, (i + 1) * 32);
    const bi = bytesToBigIntBE(slice);
    const u32 = bi <= 0xffffffffn ? Number(bi) : null;
    const u32Str = u32 === null ? '' : ` u32=${u32}`;
    console.log(`#${i} 0x${toHex(slice)} bigint=${bi.toString()}${u32Str}`);
  }
}

main();

