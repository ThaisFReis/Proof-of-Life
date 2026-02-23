import { describe, expect, it } from 'bun:test';
import { shouldRunAssassinTickFallback } from './pipeline';

describe('ui/pipeline fallback policy', () => {
  it('runs fallback only in dev mode when ping proof is not confirmed', () => {
    expect(shouldRunAssassinTickFallback({ devMode: true, pingProofConfirmed: false, zkVerifiersReady: true })).toBe(true);
    expect(shouldRunAssassinTickFallback({ devMode: true, pingProofConfirmed: true, zkVerifiersReady: true })).toBe(false);
    expect(shouldRunAssassinTickFallback({ devMode: false, pingProofConfirmed: false, zkVerifiersReady: true })).toBe(false);
    expect(shouldRunAssassinTickFallback({ devMode: false, pingProofConfirmed: true, zkVerifiersReady: true })).toBe(false);
    expect(shouldRunAssassinTickFallback({ devMode: true, pingProofConfirmed: false, zkVerifiersReady: false })).toBe(false);
  });
});
