export type ZkCircuitManifest = {
  circuitName: 'ping_distance';
  circuitVersion: string;
  proofSystem: 'ultrahonk';
  curve: 'bn254';
  publicInputLayoutVersion: 'v3';
  publicInputLayout: readonly ['tower_x', 'tower_y', 'session_id', 'turn', 'commitment', 'd2'];
  proofEncodingVersion: string;
  vkHash: string;
};

export const PING_DISTANCE_MANIFEST: ZkCircuitManifest = {
  circuitName: 'ping_distance',
  circuitVersion: 'v3',
  proofSystem: 'ultrahonk',
  curve: 'bn254',
  publicInputLayoutVersion: 'v3',
  publicInputLayout: ['tower_x', 'tower_y', 'session_id', 'turn', 'commitment', 'd2'],
  proofEncodingVersion: 'bytes_and_fields',
  // Local canonical ping_distance VK hash (from circuits/ping_distance/target/vk_hash).
  vkHash: '0d47a746243c9a03595e44116ca5d8afb44fd324f8486e73e1ed18a78845b483',
};

// Embedded defaults for the currently wired testnet deployment.
// Env vars remain the preferred source and override these values when present.
const DEFAULT_EXPECTED_PING_VERIFIER = 'CC2UAOHTSJINX37O22YJUXFCYAHLDL5NQSHQLGAZSGDJZKDPHPV43ZWS';
const DEFAULT_EXPECTED_LAYOUT_VERSION = 'v3';
const DEFAULT_EXPECTED_CIRCUIT_VERSION = 'v3';
const DEFAULT_EXPECTED_PING_VK_HASH = '0d47a746243c9a03595e44116ca5d8afb44fd324f8486e73e1ed18a78845b483';

export type ZkCompatibilityDecision = {
  ok: boolean;
  local: {
    layoutVersion: string;
    circuitVersion: string;
    vkHash: string;
  };
  reasonCodes: Array<
    | 'deployed_ping_verifier_mismatch'
    | 'layout_version_mismatch'
    | 'circuit_version_mismatch'
    | 'vk_hash_mismatch'
  >;
  reasons: string[];
};

function cleanEnv(name: string): string {
  return String((import.meta as any)?.env?.[name] ?? '').trim();
}

function normalizeContractId(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeHex(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

export function evaluatePingVerifierCompatibility(params: {
  deployedPingVerifier: string;
  secureMode: boolean;
}): ZkCompatibilityDecision {
  const expectedPingVerifier = cleanEnv('VITE_POL_EXPECTED_PING_VERIFIER') || DEFAULT_EXPECTED_PING_VERIFIER;
  const expectedLayoutVersion = cleanEnv('VITE_POL_ZK_LAYOUT_VERSION') || DEFAULT_EXPECTED_LAYOUT_VERSION;
  const expectedCircuitVersion = cleanEnv('VITE_POL_PING_CIRCUIT_VERSION') || DEFAULT_EXPECTED_CIRCUIT_VERSION;
  const expectedVkHash = cleanEnv('VITE_POL_PING_VK_HASH') || DEFAULT_EXPECTED_PING_VK_HASH;

  const reasonCodes: ZkCompatibilityDecision['reasonCodes'] = [];
  const local = {
    layoutVersion: PING_DISTANCE_MANIFEST.publicInputLayoutVersion,
    circuitVersion: PING_DISTANCE_MANIFEST.circuitVersion,
    vkHash: PING_DISTANCE_MANIFEST.vkHash,
  };

  if (!params.secureMode) {
    return { ok: true, local, reasonCodes, reasons: [] };
  }

  if (
    expectedPingVerifier &&
    normalizeContractId(expectedPingVerifier) !== normalizeContractId(params.deployedPingVerifier)
  ) {
    reasonCodes.push('deployed_ping_verifier_mismatch');
  }
  if (expectedLayoutVersion && expectedLayoutVersion !== PING_DISTANCE_MANIFEST.publicInputLayoutVersion) {
    reasonCodes.push('layout_version_mismatch');
  }
  if (expectedCircuitVersion && expectedCircuitVersion !== PING_DISTANCE_MANIFEST.circuitVersion) {
    reasonCodes.push('circuit_version_mismatch');
  }
  if (expectedVkHash && normalizeHex(expectedVkHash) !== normalizeHex(PING_DISTANCE_MANIFEST.vkHash)) {
    reasonCodes.push('vk_hash_mismatch');
  }

  const reasons =
    reasonCodes.length > 0
      ? ['secure-mode ZK compatibility preflight failed (details redacted)']
      : [];

  return { ok: reasonCodes.length === 0, local, reasonCodes, reasons };
}
