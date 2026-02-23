/**
 * Lobby code encode/decode utilities for the two-player matchmaking flow.
 *
 * Dispatcher creates a lobby code  → "POL1-<base64url>"
 * Assassin responds with a response → "POL1R-<base64url>"
 *
 * Both codes are plain JSON encoded as base64url (no padding).
 * They carry no secrets — just addresses, session ID, and network context.
 */

import type { LobbyCode, LobbyResponse } from '../model';

const LOBBY_PREFIX = 'POL1-';
const RESPONSE_PREFIX = 'POL1R-';

// ── helpers ──────────────────────────────────────────────────────────────────

function toBase64url(json: string): string {
  // btoa is available in all modern browsers and Node 18+
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Add missing padding
  const rem = padded.length % 4;
  const pad = rem === 0 ? '' : '='.repeat(4 - rem);
  return atob(padded + pad);
}

// ── lobby code ────────────────────────────────────────────────────────────────

export function encodeLobbyCode(code: LobbyCode): string {
  const json = JSON.stringify({ v: code.v, sid: code.sid, d: code.d, net: code.net, cid: code.cid });
  return LOBBY_PREFIX + toBase64url(json);
}

export function decodeLobbyCode(raw: string): LobbyCode | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed.startsWith(LOBBY_PREFIX)) return null;
    const encoded = trimmed.slice(LOBBY_PREFIX.length);
    const json = fromBase64url(encoded);
    const obj = JSON.parse(json);
    if (obj.v !== 1) return null;
    if (typeof obj.sid !== 'number' || !Number.isFinite(obj.sid)) return null;
    if (typeof obj.d !== 'string' || !validateStellarAddress(obj.d)) return null;
    if (typeof obj.net !== 'string' || !obj.net) return null;
    if (typeof obj.cid !== 'string' || !obj.cid) return null;
    return { v: 1, sid: obj.sid, d: obj.d, net: obj.net, cid: obj.cid };
  } catch {
    return null;
  }
}

// ── response code ─────────────────────────────────────────────────────────────

export function encodeResponse(resp: LobbyResponse): string {
  const json = JSON.stringify({ v: resp.v, sid: resp.sid, a: resp.a });
  return RESPONSE_PREFIX + toBase64url(json);
}

export function decodeResponse(raw: string): LobbyResponse | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed.startsWith(RESPONSE_PREFIX)) return null;
    const encoded = trimmed.slice(RESPONSE_PREFIX.length);
    const json = fromBase64url(encoded);
    const obj = JSON.parse(json);
    if (obj.v !== 1) return null;
    if (typeof obj.sid !== 'number' || !Number.isFinite(obj.sid)) return null;
    if (typeof obj.a !== 'string' || !validateStellarAddress(obj.a)) return null;
    return { v: 1, sid: obj.sid, a: obj.a };
  } catch {
    return null;
  }
}

// ── address validation ────────────────────────────────────────────────────────

/** Returns true if the string looks like a valid Stellar public key (G-address). */
export function validateStellarAddress(addr: string): boolean {
  if (typeof addr !== 'string') return false;
  // Stellar public keys: 'G' + 55 base32 characters (total 56 chars)
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

// ── session ID generation ─────────────────────────────────────────────────────

/** Generates a random u32 session ID using the Web Crypto API. */
export function generateSessionId(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Ensure non-zero
  return buf[0] === 0 ? 1 : buf[0];
}
