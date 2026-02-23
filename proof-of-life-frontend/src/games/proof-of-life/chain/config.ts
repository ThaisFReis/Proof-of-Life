/**
 * Phase 4: Chain Backend Configuration Types
 * 
 * Defines configuration for connecting to Soroban RPC
 */

export type BackendMode = 'SIM' | 'ONCHAIN';

export interface ChainConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}

export interface GameConfig {
  mode: BackendMode;
  chainConfig?: ChainConfig; // Required when mode === 'ONCHAIN'
}

// Environment-based configuration
export function getChainConfig(): ChainConfig {
  const mode = (import.meta.env.VITE_BACKEND_MODE || 'SIM') as BackendMode;
  
  if (mode === 'ONCHAIN') {
    const rpcUrl = import.meta.env.VITE_RPC_URL;
    const contractId = import.meta.env.VITE_CONTRACT_ID;
    const networkPassphrase = import.meta.env.VITE_NETWORK_PASSPHRASE;
    
    if (!rpcUrl || !contractId || !networkPassphrase) {
      throw new Error(
        'ONCHAIN mode requires VITE_RPC_URL, VITE_CONTRACT_ID, and VITE_NETWORK_PASSPHRASE environment variables'
      );
    }
    
    return { rpcUrl, contractId, networkPassphrase };
  }
  
  // SIM mode doesn't need chain config
  return {
    rpcUrl: '',
    contractId: '',
    networkPassphrase: '',
  };
}

export function getGameConfig(): GameConfig {
  const mode = (import.meta.env.VITE_BACKEND_MODE || 'SIM') as BackendMode;
  
  return {
    mode,
    chainConfig: mode === 'ONCHAIN' ? getChainConfig() : undefined,
  };
}
