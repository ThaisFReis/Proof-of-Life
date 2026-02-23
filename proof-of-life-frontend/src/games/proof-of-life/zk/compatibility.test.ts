import { describe, expect, test } from 'bun:test';
import { evaluatePingVerifierCompatibility } from './compatibility';

describe('zk/compatibility', () => {
  test('fails closed in secure mode when deployed verifier mismatches expected metadata', () => {
    const badVerifier = 'CBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADB';
    const result = evaluatePingVerifierCompatibility({
      deployedPingVerifier: badVerifier,
      secureMode: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain('deployed_ping_verifier_mismatch');
    expect(result.reasons).toEqual(['secure-mode ZK compatibility preflight failed (details redacted)']);
    expect(result.reasons.join(' ')).not.toContain(badVerifier);
  });

  test('allows insecure mode without metadata gate', () => {
    const result = evaluatePingVerifierCompatibility({
      deployedPingVerifier: 'ANY',
      secureMode: false,
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCodes).toEqual([]);
    expect(result.reasons).toEqual([]);
  });
});
