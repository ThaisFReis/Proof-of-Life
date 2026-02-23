import { describe, test, expect } from 'bun:test';
import {
  encodeLobbyCode,
  decodeLobbyCode,
  encodeResponse,
  decodeResponse,
  validateStellarAddress,
  generateSessionId,
} from './lobbyCode';
import type { LobbyCode, LobbyResponse } from '../model';

// ── test fixtures ──────────────────────────────────────────────────────────────
// Stellar addresses are 56 chars: G + 55 base32 chars (A-Z, 2-7)
// Using syntactically-valid 56-char addresses derived from deployed contract IDs (C→G prefix swap)
const VALID_DISPATCHER = 'GDDAF3TG5QR5FDZXMFJI2ZTYOHQAPDOU3Z63TTZQVSVEA5X6RIKQESJB';
const VALID_ASSASSIN   = 'GA6OIQ3NHMQA3HE6275N5GYOK5BDEAAKNTNVROLSU3P253R5OGIKNGF4';

const SAMPLE_LOBBY_CODE: LobbyCode = {
  v: 1,
  sid: 12345,
  d: VALID_DISPATCHER,
  net: 'Test SDF Network ; September 2015',
  cid: 'CDDAF3TG5QR5FDZXMFJI2ZTYOHQAPDOU3Z63TTZQVSVEA5X6RIKQESJB',
};

const SAMPLE_RESPONSE: LobbyResponse = {
  v: 1,
  sid: 12345,
  a: VALID_ASSASSIN,
};

// ── lobby code round-trip ──────────────────────────────────────────────────────

describe('encodeLobbyCode / decodeLobbyCode', () => {
  test('round-trip: encode then decode returns original', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    const decoded = decodeLobbyCode(encoded);
    expect(decoded).toEqual(SAMPLE_LOBBY_CODE);
  });

  test('encoded string starts with POL1-', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    expect(encoded.startsWith('POL1-')).toBe(true);
  });

  test('encoded string does not contain POL1R- prefix', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    expect(encoded.startsWith('POL1R-')).toBe(false);
  });

  test('whitespace trimmed on decode', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    expect(decodeLobbyCode('  ' + encoded + '\n')).toEqual(SAMPLE_LOBBY_CODE);
  });

  test('returns null for empty string', () => {
    expect(decodeLobbyCode('')).toBeNull();
  });

  test('returns null for wrong prefix', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    expect(decodeLobbyCode(encoded.replace('POL1-', 'XYZ-'))).toBeNull();
  });

  test('returns null for POL1R- prefix (response, not lobby)', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    // Replacing prefix with response prefix
    expect(decodeLobbyCode(encoded.replace('POL1-', 'POL1R-'))).toBeNull();
  });

  test('returns null for tampered base64 payload', () => {
    const encoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    const tampered = encoded.slice(0, -4) + 'ZZZZ';
    expect(decodeLobbyCode(tampered)).toBeNull();
  });

  test('returns null for invalid dispatcher address', () => {
    const bad: LobbyCode = { ...SAMPLE_LOBBY_CODE, d: 'not-a-stellar-address' };
    const encoded = encodeLobbyCode(bad);
    // Manually construct raw code with invalid address
    expect(decodeLobbyCode(encoded)).toBeNull();
  });

  test('returns null for version mismatch', () => {
    const raw = 'POL1-' + btoa(JSON.stringify({ v: 99, sid: 1, d: VALID_DISPATCHER, net: 'testnet', cid: 'C...' }));
    expect(decodeLobbyCode(raw)).toBeNull();
  });

  test('returns null for missing sid field', () => {
    const raw = 'POL1-' + btoa(JSON.stringify({ v: 1, d: VALID_DISPATCHER, net: 'testnet', cid: 'C...' }));
    expect(decodeLobbyCode(raw)).toBeNull();
  });

  test('preserves large session IDs (u32 max)', () => {
    const bigSid: LobbyCode = { ...SAMPLE_LOBBY_CODE, sid: 4294967295 };
    expect(decodeLobbyCode(encodeLobbyCode(bigSid))).toEqual(bigSid);
  });
});

// ── response code round-trip ───────────────────────────────────────────────────

describe('encodeResponse / decodeResponse', () => {
  test('round-trip: encode then decode returns original', () => {
    const encoded = encodeResponse(SAMPLE_RESPONSE);
    const decoded = decodeResponse(encoded);
    expect(decoded).toEqual(SAMPLE_RESPONSE);
  });

  test('encoded string starts with POL1R-', () => {
    const encoded = encodeResponse(SAMPLE_RESPONSE);
    expect(encoded.startsWith('POL1R-')).toBe(true);
  });

  test('whitespace trimmed on decode', () => {
    const encoded = encodeResponse(SAMPLE_RESPONSE);
    expect(decodeResponse('  ' + encoded + '  ')).toEqual(SAMPLE_RESPONSE);
  });

  test('returns null for empty string', () => {
    expect(decodeResponse('')).toBeNull();
  });

  test('returns null for lobby code prefix instead of response prefix', () => {
    const lobbyEncoded = encodeLobbyCode(SAMPLE_LOBBY_CODE);
    expect(decodeResponse(lobbyEncoded)).toBeNull();
  });

  test('returns null for invalid assassin address', () => {
    const raw = 'POL1R-' + btoa(JSON.stringify({ v: 1, sid: 1, a: 'bad-address' }));
    expect(decodeResponse(raw)).toBeNull();
  });

  test('returns null for tampered payload', () => {
    const encoded = encodeResponse(SAMPLE_RESPONSE);
    const tampered = encoded.slice(0, -3) + 'XYZ';
    expect(decodeResponse(tampered)).toBeNull();
  });

  test('returns null for version mismatch', () => {
    const raw = 'POL1R-' + btoa(JSON.stringify({ v: 2, sid: 1, a: VALID_ASSASSIN }));
    expect(decodeResponse(raw)).toBeNull();
  });
});

// ── address validation ─────────────────────────────────────────────────────────

describe('validateStellarAddress', () => {
  test('valid G-address returns true', () => {
    expect(validateStellarAddress(VALID_DISPATCHER)).toBe(true);
    expect(validateStellarAddress(VALID_ASSASSIN)).toBe(true);
  });

  test('56-char all-uppercase G-address', () => {
    // G + 55 chars from A-Z2-7 = 56 total
    expect(validateStellarAddress('G' + 'A'.repeat(55))).toBe(true);
  });

  test('empty string returns false', () => {
    expect(validateStellarAddress('')).toBe(false);
  });

  test('S-address (secret key) returns false', () => {
    // S-addresses start with S, not G
    expect(validateStellarAddress('S' + 'A'.repeat(55))).toBe(false);
  });

  test('lowercase address returns false', () => {
    // Stellar addresses are uppercase only
    expect(validateStellarAddress(VALID_DISPATCHER.toLowerCase())).toBe(false);
    // Mixed case also fails
    expect(validateStellarAddress('g' + 'A'.repeat(55))).toBe(false);
  });

  test('wrong length returns false', () => {
    expect(validateStellarAddress('G' + 'A'.repeat(54))).toBe(false); // 55 chars total (too short)
    expect(validateStellarAddress('G' + 'A'.repeat(56))).toBe(false); // 57 chars total (too long)
  });

  test('invalid base32 character (0, 1, 8, 9) returns false', () => {
    expect(validateStellarAddress('G' + '0'.repeat(55))).toBe(false);
    expect(validateStellarAddress('G' + '1'.repeat(55))).toBe(false);
  });

  test('non-string input returns false', () => {
    expect(validateStellarAddress(null as any)).toBe(false);
    expect(validateStellarAddress(undefined as any)).toBe(false);
    expect(validateStellarAddress(123 as any)).toBe(false);
  });
});

// ── generateSessionId ──────────────────────────────────────────────────────────

describe('generateSessionId', () => {
  test('returns a positive integer', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });

  test('stays within u32 range', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test('generates different values (probabilistic)', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateSessionId()));
    // With u32 space, 10 unique values out of 10 is overwhelmingly likely
    expect(ids.size).toBeGreaterThan(1);
  });
});
