import CryptoJS from 'crypto-js';
import type { SecretState } from '../sim/engine';

// Ephemeral key storage (closure).
// This key is generated once per page load and is NOT accessible via React/Redux devtools.
let SESSION_KEY: string | null = null;

function getSessionKey(): string {
  if (!SESSION_KEY) {
    // Generate a random 256-bit key
    SESSION_KEY = CryptoJS.lib.WordArray.random(32).toString();
  }
  return SESSION_KEY!;
}

/**
 * Branded type for encrypted secret state.
 * Prevents accidental usage of the encrypted string as a raw object.
 */
export type EncryptedSecret = string & { __brand: 'EncryptedSecret' };

export const encryption = {
  encrypt(secret: SecretState): EncryptedSecret {
    const key = getSessionKey();
    const json = JSON.stringify(secret);
    const encrypted = CryptoJS.AES.encrypt(json, key).toString();
    return encrypted as EncryptedSecret;
  },

  decrypt(encrypted: EncryptedSecret): SecretState {
    const key = getSessionKey();
    const bytes = CryptoJS.AES.decrypt(encrypted, key);
    const json = bytes.toString(CryptoJS.enc.Utf8);
    if (!json) {
      throw new Error('Decryption failed: invalid key or corrupted data');
    }
    return JSON.parse(json) as SecretState;
  },
};
