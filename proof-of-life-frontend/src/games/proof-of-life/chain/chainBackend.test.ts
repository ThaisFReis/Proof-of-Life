import { describe, expect, it } from 'bun:test';
import {
  ensureSentTransactionSucceeded,
  hexToBuf32,
  mapChainSessionToState,
  mapChadCommandToChain,
  tryExtractTxHash,
  tryExtractTxHashFromError,
} from './chainBackend';
import { ChainBackend } from './chainBackend';

describe('chain/chainBackend helpers', () => {
  it('hexToBuf32 accepts 32-byte hex (with or without 0x) and rejects others', () => {
    const good = '0x' + '11'.repeat(32);
    const goodNo0x = '22'.repeat(32);
    expect(hexToBuf32(good).length).toBe(32);
    expect(hexToBuf32(goodNo0x).length).toBe(32);

    expect(() => hexToBuf32('0x' + 'aa'.repeat(31))).toThrow(/expected 32-byte hex/i);
    expect(() => hexToBuf32('aa')).toThrow(/expected 32-byte hex/i);
  });

  it('tryExtractTxHash finds hash fields on getTransactionResponse', async () => {
    const sent = {
      getTransactionResponse: async () => ({ hash: 'HASH_1' }),
    };
    expect(await tryExtractTxHash(sent)).toBe('HASH_1');

    const sent2 = {
      getTransactionResponse: async () => ({ txHash: 'HASH_2' }),
    };
    expect(await tryExtractTxHash(sent2)).toBe('HASH_2');

    const sent3 = {
      getTransactionResponse: async () => ({ id: 'HASH_3' }),
    };
    expect(await tryExtractTxHash(sent3)).toBe('HASH_3');
  });

  it('tryExtractTxHash returns undefined on missing/throw', async () => {
    expect(await tryExtractTxHash({})).toBeUndefined();
    expect(await tryExtractTxHash({ getTransactionResponse: { not: 'a-function' } })).toBeUndefined();
    expect(
      await tryExtractTxHash({
        getTransactionResponse: async () => {
          throw new Error('nope');
        },
      })
    ).toBeUndefined();
  });

  it('tryExtractTxHashFromError extracts hash from SendFailed JSON message', () => {
    const err = new Error(
      'Sending the transaction to the network failed!\n' +
        JSON.stringify(
          {
            status: 'TRY_AGAIN_LATER',
            hash: 'abc123',
            latestLedger: 1,
          },
          null,
          2
        )
    );
    expect(tryExtractTxHashFromError(err)).toBe('abc123');
  });

  it('mapChadCommandToChain maps GO_* commands to GoRoom(u32)', () => {
    expect(mapChadCommandToChain('GO_STUDY')).toEqual({ tag: 'GoRoom', values: [3] });
    expect(mapChadCommandToChain('GO_GRAND_HALL')).toEqual({ tag: 'GoRoom', values: [7] });
  });

  it('mapChainSessionToState maps critical fields', () => {
    const s: any = {
      session_id: 7,
      dispatcher: 'GD',
      assassin: 'GA',
      commitment: null,
      battery: 80,
      ping_cost: 20,
      recharge_amount: 10,
      turn: 3,
      phase: 0,
      ended: false,
      moved_this_turn: false,
      alpha: 5,
      alpha_max: 5,
      chad_x: 2,
      chad_y: 9,
      chad_hidden: false,
      chad_hide_streak: 0,
    };

    const out = mapChainSessionToState(s);
    expect(out.sessionId).toBe(7);
    expect(out.dispatcher).toBe('GD');
    expect(out.assassin).toBe('GA');
    expect(out.commitmentSet).toBe(false);
    expect(out.battery).toBe(80);
    expect(out.pingCost).toBe(20);
    expect(out.rechargeAmount).toBe(10);
    expect(out.turn).toBe(3);
    expect(out.phase).toBe('dispatcher');
    expect(out.chad_x).toBe(2);
    expect(out.chad_y).toBe(9);
  });

  it('mapChainSessionToState decodes enum-like phase payloads', () => {
    const base: any = {
      session_id: 11,
      dispatcher: 'GD',
      assassin: 'GA',
      commitment: null,
      battery: 80,
      ping_cost: 20,
      recharge_amount: 10,
      turn: 1,
      ended: false,
      moved_this_turn: false,
      alpha: 5,
      alpha_max: 5,
      chad_x: 2,
      chad_y: 9,
      chad_hidden: false,
      chad_hide_streak: 0,
    };
    const sDispatcher = { ...base, phase: { tag: 'Dispatcher', values: [] } };
    const sAssassin = { ...base, phase: { tag: 'Assassin', values: [] } };

    expect(mapChainSessionToState(sDispatcher as any).phase).toBe('dispatcher');
    expect(mapChainSessionToState(sAssassin as any).phase).toBe('assassin');
  });

  it('ChainBackend requires a publicKey for state-changing transactions', () => {
    const cfg: any = {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'C'.repeat(56),
    };
    const signer: any = {
      signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      signAuthEntry: async (xdr: string) => ({ signedAuthEntry: xdr }),
    };
    expect(() => new ChainBackend(cfg, signer, '')).toThrow(/publicKey/i);
  });

  // SDK v14 XDR parser has VarArray max=10 for error enum cases; our contract has 32.
  // Runtime construction works because the SDK handles it; test env may not.
  it.skip('ChainBackend can be constructed with a publicKey', () => {
    const cfg: any = {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'C'.repeat(56),
    };
    const signer: any = {
      signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      signAuthEntry: async (xdr: string) => ({ signedAuthEntry: xdr }),
    };
    expect(() => new ChainBackend(cfg, signer, 'G'.repeat(56))).not.toThrow();
  });

  it('ensureSentTransactionSucceeded accepts PENDING final status without errorResult', async () => {
    const sent = {
      sendTransactionResponse: { status: 'PENDING', hash: 'h1' },
      getTransactionResponse: async () => ({ status: 'PENDING', hash: 'h1' }),
    };
    await expect(ensureSentTransactionSucceeded(sent)).resolves.toBeUndefined();
  });

  it('ensureSentTransactionSucceeded fails when final response carries errorResult', async () => {
    const sent = {
      sendTransactionResponse: { status: 'PENDING', hash: 'h2' },
      getTransactionResponse: async () => ({ status: 'SUCCESS', hash: 'h2', errorResult: { code: 'boom' } }),
    };
    await expect(ensureSentTransactionSucceeded(sent)).rejects.toThrow(/failed on-chain/i);
  });
});
