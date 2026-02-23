/**
 * Phase 4: Unified Backend Interface
 * 
 * Provides a common interface for both SIM and ONCHAIN modes
 */

import type { ChadCommand, SessionState, TowerId } from '../model';

// Transaction result (for ONCHAIN mode)
export interface TxResult {
  txHash: string;
  events?: any[];
}

// Common result type
export type BackendResult<T = void> = T extends void
  ? { success: boolean; txHash?: string }
  : { success: boolean; data: T; txHash?: string };

/**
 * Unified backend interface
 * Both SIM and ONCHAIN backends implement this
 */
export interface Backend {
  // Session management
  startGame(params: {
    sessionId: number;
    dispatcher: string;
    assassin: string;
    dispatcherPoints?: bigint;
    assassinPoints?: bigint;
  }): Promise<BackendResult>;

  getSession(sessionId: number): Promise<SessionState>;

  // Dispatcher actions
  dispatcherCommand(params: {
    sessionId: number;
    dispatcher: string;
    command: ChadCommand;
  }): Promise<BackendResult>;

  requestPing(params: {
    sessionId: number;
    dispatcher: string;
    towerId: number;
  }): Promise<BackendResult>;

  recharge(params: {
    sessionId: number;
    dispatcher: string;
  }): Promise<BackendResult>;

  // Assassin actions
  commitLocation(params: {
    sessionId: number;
    assassin: string;
    commitment: string; // Hex string
  }): Promise<BackendResult>;

  submitPingProof(params: {
    sessionId: number;
    assassin: string;
    towerId: number;
    d2: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult<number>>; // Returns d2

  submitMoveProof(params: {
    sessionId: number;
    assassin: string;
    newCommitment: string;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult>;

  submitTurnStatusProof(params: {
    sessionId: number;
    assassin: string;
    d2Chad: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult>;
}
