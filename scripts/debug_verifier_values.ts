#!/usr/bin/env bun
/**
 * Debug: compute Fiat-Shamir transcript values from proof artifacts.
 *
 * This script replicates the Solidity/Rust transcript logic in TypeScript
 * so you can compare intermediate challenge values against the on-chain verifier.
 *
 * Usage:
 *   bun run scripts/debug_verifier_values.ts [circuit_name]
 *   # circuit_name: ping_distance | turn_status | move_proof (default: ping_distance)
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import fs from 'node:fs';
import path from 'node:path';

// BN254 scalar field modulus
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Ethereum keccak256 (pre-NIST Keccak, NOT sha3-256).
 */
function keccak256Eth(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

function frFromBytes(bytes: Uint8Array): bigint {
  let val = 0n;
  for (let i = 0; i < 32; i++) {
    val = (val << 8n) | BigInt(bytes[i]);
  }
  return val % P;
}

function frToHex(val: bigint): string {
  return '0x' + val.toString(16).padStart(64, '0');
}

function splitChallenge(challenge: bigint): [bigint, bigint] {
  const lo = challenge & ((1n << 127n) - 1n);
  const hi = challenge >> 127n;
  return [lo % P, hi % P];
}

function hashToFr(data: Uint8Array): bigint {
  const hash = keccak256Eth(data);
  return frFromBytes(hash);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function bigintToBytes32(val: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = val;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

// ---- Main ----

const PAIRING_POINTS_SIZE = 16;
const BATCHED_RELATION_PARTIAL_LENGTH = 8;
const NUMBER_OF_ENTITIES = 41;
const NUMBER_OF_ALPHAS = 27;

type CircuitName = 'ping_distance' | 'turn_status' | 'move_proof';

const circuitName = (process.argv[2] || 'ping_distance') as CircuitName;
const repoRoot = path.join(import.meta.dir, '..');
const circuitDir = path.join(repoRoot, 'circuits', circuitName, 'target');

// Load artifacts
const vkBuf = fs.readFileSync(path.join(circuitDir, 'vk'));
const vkHashBuf = fs.readFileSync(path.join(circuitDir, 'vk_hash'));
const proofBuf = fs.readFileSync(path.join(circuitDir, 'proof'));
const piBuf = fs.readFileSync(path.join(circuitDir, 'public_inputs'));

console.log(`=== Debug Verifier Values: ${circuitName} ===`);
console.log(`  proof:   ${proofBuf.length} bytes`);
console.log(`  vk:      ${vkBuf.length} bytes`);
console.log(`  vk_hash: ${vkHashBuf.length} bytes`);
console.log(`  pi:      ${piBuf.length} bytes (${piBuf.length / 32} fields)`);

// Parse VK header
const logN = Number(
  BigInt('0x' + Buffer.from(vkBuf.subarray(24, 32)).toString('hex'))
);
const publicInputsSize = Number(
  BigInt('0x' + Buffer.from(vkBuf.subarray(56, 64)).toString('hex'))
);
const pubInputsOffset = Number(
  BigInt('0x' + Buffer.from(vkBuf.subarray(88, 96)).toString('hex'))
);

console.log(`  log_n: ${logN}`);
console.log(`  public_inputs_size: ${publicInputsSize}`);
console.log(`  pub_inputs_offset: ${pubInputsOffset}`);
console.log();

// Parse proof
let cursor = 0;
function readFr(): bigint {
  const bytes = proofBuf.subarray(cursor, cursor + 32);
  cursor += 32;
  return frFromBytes(new Uint8Array(bytes));
}
function readG1(): Uint8Array {
  const bytes = proofBuf.subarray(cursor, cursor + 64);
  cursor += 64;
  return new Uint8Array(bytes);
}

// Pairing point object
const pairingPointObject: bigint[] = [];
for (let i = 0; i < PAIRING_POINTS_SIZE; i++) {
  pairingPointObject.push(readFr());
}

// w1, w2, w3
const w1 = readG1();
const w2 = readG1();
const w3 = readG1();

// lookupReadCounts, lookupReadTags
const lookupReadCounts = readG1();
const lookupReadTags = readG1();

// w4
const w4 = readG1();

// lookupInverses, zPerm
const lookupInverses = readG1();
const zPerm = readG1();

// Sumcheck univariates
const sumcheckUnivariates: bigint[][] = [];
for (let r = 0; r < logN; r++) {
  const row: bigint[] = [];
  for (let i = 0; i < BATCHED_RELATION_PARTIAL_LENGTH; i++) {
    row.push(readFr());
  }
  sumcheckUnivariates.push(row);
}

// Sumcheck evaluations
const sumcheckEvaluations: bigint[] = [];
for (let i = 0; i < NUMBER_OF_ENTITIES; i++) {
  sumcheckEvaluations.push(readFr());
}

// Gemini fold comms
const geminiFoldComms: Uint8Array[] = [];
for (let i = 0; i < logN - 1; i++) {
  geminiFoldComms.push(readG1());
}

// Gemini evaluations
const geminiAEvaluations: bigint[] = [];
for (let i = 0; i < logN; i++) {
  geminiAEvaluations.push(readFr());
}

// shplonkQ, kzgQuotient
const shplonkQ = readG1();
const kzgQuotient = readG1();

console.log(`Proof parsed: ${cursor} bytes consumed (expected ${proofBuf.length})`);
if (cursor !== proofBuf.length) {
  console.error('WARNING: proof size mismatch!');
}
console.log();

// ---- Transcript computation ----

// User public inputs count
const userPiCount = publicInputsSize - PAIRING_POINTS_SIZE;
const userPiBytes = piBuf.subarray(0, userPiCount * 32);

// 1) Eta challenge
console.log('=== Eta Challenge ===');
const etaData = concatBytes(
  new Uint8Array(vkHashBuf),
  new Uint8Array(userPiBytes),
  ...pairingPointObject.map(bigintToBytes32),
  w1,
  w2,
  w3
);
console.log(`  eta_data len = ${etaData.length}`);

let previousChallenge = hashToFr(etaData);
console.log(`  eta_hash = ${frToHex(previousChallenge)}`);

const [eta, etaTwo] = splitChallenge(previousChallenge);
console.log(`  eta     = ${frToHex(eta)}`);
console.log(`  eta_two = ${frToHex(etaTwo)}`);

previousChallenge = hashToFr(bigintToBytes32(previousChallenge));
const [etaThree] = splitChallenge(previousChallenge);
console.log(`  eta_three = ${frToHex(etaThree)}`);
console.log();

// 2) Beta/Gamma
console.log('=== Beta/Gamma ===');
const bgData = concatBytes(
  bigintToBytes32(previousChallenge),
  lookupReadCounts,
  lookupReadTags,
  w4
);
previousChallenge = hashToFr(bgData);
const [beta, gamma] = splitChallenge(previousChallenge);
console.log(`  beta  = ${frToHex(beta)}`);
console.log(`  gamma = ${frToHex(gamma)}`);
console.log();

// 3) Alpha
console.log('=== Alpha ===');
const alphaData = concatBytes(
  bigintToBytes32(previousChallenge),
  lookupInverses,
  zPerm
);
previousChallenge = hashToFr(alphaData);
const [alpha] = splitChallenge(previousChallenge);
console.log(`  alpha = ${frToHex(alpha)}`);

const alphas: bigint[] = new Array(NUMBER_OF_ALPHAS);
alphas[0] = alpha;
for (let i = 1; i < NUMBER_OF_ALPHAS; i++) {
  alphas[i] = (alphas[i - 1] * alpha) % P;
}
console.log();

// 4) Gate challenges
console.log('=== Gate Challenges ===');
previousChallenge = hashToFr(bigintToBytes32(previousChallenge));
const [gc0] = splitChallenge(previousChallenge);
console.log(`  gate_challenge[0] = ${frToHex(gc0)}`);

const gateChallenges: bigint[] = new Array(logN);
gateChallenges[0] = gc0;
for (let i = 1; i < logN; i++) {
  gateChallenges[i] = (gateChallenges[i - 1] * gateChallenges[i - 1]) % P;
}
console.log();

// 5) Sumcheck challenges
console.log('=== Sumcheck Challenges ===');
const sumcheckChallenges: bigint[] = [];
for (let r = 0; r < logN; r++) {
  const roundData = concatBytes(
    bigintToBytes32(previousChallenge),
    ...sumcheckUnivariates[r].map(bigintToBytes32)
  );
  previousChallenge = hashToFr(roundData);
  const [u] = splitChallenge(previousChallenge);
  sumcheckChallenges.push(u);
  console.log(`  sumcheck_u[${r}] = ${frToHex(u)}`);
}
console.log();

// 6) Rho
console.log('=== Rho ===');
const rhoData = concatBytes(
  bigintToBytes32(previousChallenge),
  ...sumcheckEvaluations.map(bigintToBytes32)
);
previousChallenge = hashToFr(rhoData);
const [rho] = splitChallenge(previousChallenge);
console.log(`  rho = ${frToHex(rho)}`);
console.log();

// 7) Gemini R
console.log('=== Gemini R ===');
const geminiRData = concatBytes(
  bigintToBytes32(previousChallenge),
  ...geminiFoldComms
);
previousChallenge = hashToFr(geminiRData);
const [geminiR] = splitChallenge(previousChallenge);
console.log(`  gemini_r = ${frToHex(geminiR)}`);
console.log();

// 8) Shplonk Nu
console.log('=== Shplonk Nu ===');
const nuData = concatBytes(
  bigintToBytes32(previousChallenge),
  ...geminiAEvaluations.map(bigintToBytes32)
);
previousChallenge = hashToFr(nuData);
const [shplonkNu] = splitChallenge(previousChallenge);
console.log(`  shplonk_nu = ${frToHex(shplonkNu)}`);
console.log();

// 9) Shplonk Z
console.log('=== Shplonk Z ===');
const zData = concatBytes(bigintToBytes32(previousChallenge), shplonkQ);
previousChallenge = hashToFr(zData);
const [shplonkZ] = splitChallenge(previousChallenge);
console.log(`  shplonk_z = ${frToHex(shplonkZ)}`);
console.log();

console.log('=== Done ===');
console.log('Compare these values with `cargo test --features "std,trace" -- --nocapture debug_`');
