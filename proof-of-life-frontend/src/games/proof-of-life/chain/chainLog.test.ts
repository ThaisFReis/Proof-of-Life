import { describe, expect, test } from 'bun:test';
import { appendChainLog, fakeTxHash, formatChainLine, mkChainContextFrom } from './chainLog';

describe('chain/chainLog', () => {
  test('fakeTxHash is deterministic', () => {
    expect(fakeTxHash('a')).toBe(fakeTxHash('a'));
    expect(fakeTxHash('a')).not.toBe(fakeTxHash('b'));
  });

  test('appendChainLog keeps a fixed limit', () => {
    let log: any[] = [];
    for (let i = 0; i < 10; i++) log = appendChainLog(log, { ts: i, level: 'INFO', msg: String(i) }, 5);
    expect(log.length).toBe(5);
    expect(log[0].msg).toBe('5');
    expect(log[4].msg).toBe('9');
  });

  test('formatChainLine includes timestamp and level', () => {
    const line = formatChainLine({ ts: 0, level: 'WARN', msg: 'X' });
    expect(line).toMatch(/WARN/);
    expect(line).toMatch(/X/);
  });

  test('mkChainContextFrom can build a TESTNET context', () => {
    const ctx = mkChainContextFrom({
      network: 'TESTNET',
      contracts: { game: 'C_GAME', verifierPing: 'C_V_PING' },
    });
    expect(ctx.network).toBe('TESTNET');
    expect(ctx.contracts.game).toBe('C_GAME');
    expect(ctx.contracts.verifierPing).toBe('C_V_PING');
  });
});
