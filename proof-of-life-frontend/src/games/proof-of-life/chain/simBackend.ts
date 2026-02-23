/**
 * Phase 4: SIM Backend Wrapper
 * 
 * Wraps the existing localBackend.ts to implement the Backend interface
 */

import type { Backend, BackendResult } from './backendInterface';
import type { SessionState, ChadCommand } from '../model';
import * as LocalBackend from '../localBackend';

/**
 * SIM backend - wraps local simulation
 */
export class SimBackend implements Backend {
  private state: SessionState | null = null;

  async startGame(params: {
    sessionId: number;
    dispatcher: string;
    assassin: string;
  }): Promise<BackendResult> {
    this.state = LocalBackend.createSession({
      sessionId: params.sessionId,
      mode: 'single', // Default to single player for SIM
      dispatcher: params.dispatcher,
      assassin: params.assassin,
    });

    return {
      success: true,
      txHash: `SIM-START-${Date.now()}`,
    };
  }

  async getSession(sessionId: number): Promise<SessionState> {
    if (!this.state || this.state.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found in SIM mode`);
    }
    return this.state;
  }

  async dispatcherCommand(params: {
    sessionId: number;
    dispatcher: string;
    command: ChadCommand;
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    this.state = LocalBackend.setChadCommand(
      this.state,
      params.dispatcher,
      params.command
    );

    return {
      success: true,
      txHash: `SIM-CMD-${Date.now()}`,
    };
  }

  async requestPing(params: {
    sessionId: number;
    dispatcher: string;
    towerId: number;
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    // Map tower ID to tower name
    const towerMap: Record<number, 'N' | 'S' | 'E' | 'W'> = {
      0: 'N',
      1: 'E',
      2: 'S',
      3: 'W',
    };

    this.state = LocalBackend.requestPing(
      this.state,
      params.dispatcher,
      towerMap[params.towerId] || 'N'
    );

    return {
      success: true,
      txHash: `SIM-PING-${Date.now()}`,
    };
  }

  async recharge(params: {
    sessionId: number;
    dispatcher: string;
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    this.state = LocalBackend.recharge(this.state, params.dispatcher);

    return {
      success: true,
      txHash: `SIM-RECHARGE-${Date.now()}`,
    };
  }

  async commitLocation(params: {
    sessionId: number;
    assassin: string;
    commitment: string;
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    this.state = LocalBackend.commitLocation(this.state, params.assassin);

    return {
      success: true,
      txHash: `SIM-COMMIT-${Date.now()}`,
    };
  }

  async submitPingProof(params: {
    sessionId: number;
    assassin: string;
    towerId: number;
    d2: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult<number>> {
    if (!this.state) {
      throw new Error('No active session');
    }

    // In SIM mode, just accept the d2 value
    // (Real verification happens in ONCHAIN mode)

    return {
      success: true,
      data: params.d2,
      txHash: `SIM-PING-PROOF-${Date.now()}`,
    };
  }

  async submitMoveProof(params: {
    sessionId: number;
    assassin: string;
    newCommitment: string;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    // In SIM mode, just accept the move
    // (Real verification happens in ONCHAIN mode)

    return {
      success: true,
      txHash: `SIM-MOVE-PROOF-${Date.now()}`,
    };
  }

  async submitTurnStatusProof(params: {
    sessionId: number;
    assassin: string;
    d2Chad: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult> {
    if (!this.state) {
      throw new Error('No active session');
    }

    // Advance turn in SIM mode
    this.state = LocalBackend.assassinTick(this.state, params.assassin);

    return {
      success: true,
      txHash: `SIM-TURN-STATUS-${Date.now()}`,
    };
  }
}
