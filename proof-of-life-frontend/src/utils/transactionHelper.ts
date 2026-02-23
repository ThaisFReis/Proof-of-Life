/**
 * Transaction helper utilities
 */

import { contract, SorobanDataBuilder } from '@stellar/stellar-sdk';

/**
 * Sign and send a transaction via Launchtube
 * @param tx - The assembled transaction or XDR string
 * @param timeoutInSeconds - Timeout for the transaction
 * @param validUntilLedgerSeq - Valid until ledger sequence
 * @returns Transaction result
 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;
const RESOURCE_BUMP_FACTORS = [1.3, 1.8, 2.4, 3.2, 4.8];
const RESOURCE_FEE_BUMP_FACTOR = 1.4;
// Observed on Soroban testnet diagnostic events:
// "transaction byte-write resources exceed network config limit", requested 158928, limit 132096.
const TESTNET_MAX_WRITE_BYTES = 132096n;
const CHAIN_DEBUG = String((import.meta as any)?.env?.VITE_CHAIN_DEBUG ?? '').toLowerCase() === 'true';

function isTryAgainLater(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('TRY_AGAIN_LATER');
}

function isResourceLimitExceeded(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /ResourceLimitExceeded/i.test(msg) || /resource_limit_exceeded/i.test(msg) || msg.includes('tx_insufficient_fee');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.max(0, Math.ceil(value)));
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object') {
    const maybeObj = value as { toBigInt?: () => bigint; toString?: () => string };
    if (typeof maybeObj.toBigInt === 'function') return maybeObj.toBigInt();
    if (typeof maybeObj.toString === 'function') return BigInt(maybeObj.toString());
  }
  return 0n;
}

function multiplyCeil(value: bigint, factor: number): bigint {
  const scale = 1000n;
  const scaledFactor = BigInt(Math.ceil(factor * Number(scale)));
  return (value * scaledFactor + (scale - 1n)) / scale;
}

function toSetterNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > max ? max : value);
}

function applyResourceBuffer(simulated: any, factor: number): void {
  const simData = simulated?.simulationData;
  const txData = simData?.transactionData as any;
  if (!txData || typeof txData.resources !== 'function') return;

  const resources = txData.resources();
  const currentCpu = toBigIntValue(resources.instructions());
  const currentRead = toBigIntValue(resources.diskReadBytes());
  const currentWrite = toBigIntValue(resources.writeBytes());

  const bumpedCpu = multiplyCeil(currentCpu, factor);
  const bumpedRead = multiplyCeil(currentRead, factor);
  const bumpedWriteRaw = multiplyCeil(currentWrite, factor);
  const bumpedWrite = bumpedWriteRaw > TESTNET_MAX_WRITE_BYTES ? TESTNET_MAX_WRITE_BYTES : bumpedWriteRaw;
  const currentFee = toBigIntValue(typeof txData.resourceFee === 'function' ? txData.resourceFee() : 0);
  const bumpedFee = multiplyCeil(currentFee, Math.max(RESOURCE_FEE_BUMP_FACTOR, factor));

  // Rebuild Soroban transaction data through official builder API.
  // This avoids fragile low-level XDR mutations and ensures sign() sees updated values.
  const rebuilt = new SorobanDataBuilder(txData)
    .setResources(toSetterNumber(bumpedCpu), toSetterNumber(bumpedRead), toSetterNumber(bumpedWrite))
    .setResourceFee(bumpedFee.toString())
    .build();

  // SDK uses `simulationTransactionData` when signing.
  (simulated as any).simulationTransactionData = rebuilt;

  if (CHAIN_DEBUG) {
    console.info(
      `[tx] Soroban resources bumped (x${factor.toFixed(2)}): cpu ${currentCpu}→${bumpedCpu}, read ${currentRead}→${bumpedRead}, write ${currentWrite}→${bumpedWrite}${bumpedWriteRaw !== bumpedWrite ? ` (clamped from ${bumpedWriteRaw})` : ''}, fee ${currentFee}→${bumpedFee}`
    );
  }
}

export async function signAndSendViaLaunchtube(
  tx: contract.AssembledTransaction<any> | string,
  timeoutInSeconds: number = 30,
  validUntilLedgerSeq?: number,
  minResourceBumpIndex: number = 0
): Promise<contract.SentTransaction<any>> {
  // If tx is an AssembledTransaction, simulate and send
  if (typeof tx !== 'string' && 'simulate' in tx) {
    // Retry wrapper for TRY_AGAIN_LATER network congestion
    const sendWithRetry = async (
      simulatedTx: any,
      opts?: { force?: boolean },
    ): Promise<contract.SentTransaction<any>> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await simulatedTx.signAndSend(opts);
        } catch (e) {
          lastErr = e;
          if (isTryAgainLater(e) && attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * 2 ** attempt;
            if (CHAIN_DEBUG) {
              console.warn(
                `[tx] TRY_AGAIN_LATER — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
              );
            }
            await sleep(delay);
            continue;
          }
          throw e;
        }
      }
      throw lastErr;
    };

    const sendWithReadOnlyFallback = async (simulatedTx: any): Promise<contract.SentTransaction<any>> => {
      try {
        return await sendWithRetry(simulatedTx);
      } catch (err: any) {
        const errName = err?.name ?? '';
        const errMessage = err instanceof Error ? err.message : String(err);
        const isNoSignatureNeeded =
          errName.includes('NoSignatureNeededError') ||
          errMessage.includes('NoSignatureNeededError') ||
          errMessage.includes('This is a read call') ||
          errMessage.includes('requires no signature') ||
          errMessage.includes('force: true');

        // Some contract bindings incorrectly classify state-changing methods as "read calls".
        // In those cases, the SDK requires `force: true` to sign and send anyway.
        if (isNoSignatureNeeded) {
          try {
            return await sendWithRetry(simulatedTx, { force: true });
          } catch (forceErr: any) {
            const forceName = forceErr?.name ?? '';
            const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
            const isStillReadOnly =
              forceName.includes('NoSignatureNeededError') ||
              forceMessage.includes('NoSignatureNeededError') ||
              forceMessage.includes('This is a read call') ||
              forceMessage.includes('requires no signature');

            // If the SDK still says it's a read call, treat the simulation result as the final result.
            if (isStillReadOnly) {
              const simulatedResult =
                (simulatedTx as any).result ??
                (simulatedTx as any).simulationResult?.result ??
                (simulatedTx as any).returnValue ??
                (tx as any).result;

              return {
                result: simulatedResult,
                getTransactionResponse: undefined,
              } as unknown as contract.SentTransaction<any>;
            }

            throw forceErr;
          }
        }

        throw err;
      }
    };

    let lastResourceErr: unknown;
    const startIdx = Math.max(0, Math.min(minResourceBumpIndex, RESOURCE_BUMP_FACTORS.length - 1));
    for (let i = startIdx; i < RESOURCE_BUMP_FACTORS.length; i++) {
      const factor = RESOURCE_BUMP_FACTORS[i];
      const simulated = await tx.simulate();
      try {
        applyResourceBuffer(simulated, factor);
      } catch (e) {
        if (CHAIN_DEBUG) {
          console.warn('[tx] Could not inflate resources (non-fatal):', e);
        }
      }

      try {
        return await sendWithReadOnlyFallback(simulated);
      } catch (err: any) {
        lastResourceErr = err;
        if (!isResourceLimitExceeded(err) || i >= RESOURCE_BUMP_FACTORS.length - 1) {
          throw err;
        }
        if (CHAIN_DEBUG) {
          console.warn(`[tx] Resource limit exceeded; retrying with larger Soroban buffer (${i + 2}/${RESOURCE_BUMP_FACTORS.length})`);
        }
      }
    }

    try {
      throw lastResourceErr;
    } catch (err: any) {
      const errName = err?.name ?? '';
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNoSignatureNeeded =
        errName.includes('NoSignatureNeededError') ||
        errMessage.includes('NoSignatureNeededError') ||
        errMessage.includes('This is a read call') ||
        errMessage.includes('requires no signature') ||
        errMessage.includes('force: true');

      throw err;
    }
  }

  // If tx is XDR string, it needs to be sent directly
  // This is typically used for multi-sig flows where the transaction is already built
  throw new Error('Direct XDR submission not yet implemented. Use AssembledTransaction.signAndSend() instead.');
}
