/**
 * Phase 4: Backend Factory
 * 
 * Creates the appropriate backend based on configuration
 */

import type { Backend } from './backendInterface';
import type { GameConfig } from './config';
import { ChainBackend } from './chainBackend';
import { SimBackend } from './simBackend';
import type { ContractSigner } from '@/types/signer';

/**
 * Create a backend instance based on configuration
 */
export function createBackend(config: GameConfig, signer?: ContractSigner, publicKey?: string): Backend {
  if (config.mode === 'ONCHAIN') {
    if (!config.chainConfig) {
      throw new Error('Chain config required for ONCHAIN mode');
    }
    if (!signer) {
      throw new Error('Signer required for ONCHAIN mode');
    }
    if (!publicKey) {
      throw new Error('Public key required for ONCHAIN mode');
    }
    return new ChainBackend(config.chainConfig, signer, publicKey);
  } else {
    return new SimBackend();
  }
}

// Re-export types for convenience
export type { Backend, BackendResult } from './backendInterface';
export type { GameConfig, ChainConfig, BackendMode } from './config';
export { getGameConfig, getChainConfig } from './config';
