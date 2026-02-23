/**
 * Phase 6: Chain Backend Implementation
 *
 * Connects to real Soroban RPC and executes transactions on-chain using the
 * generated TypeScript bindings (from `stellar contract bindings typescript`).
 */

import { Buffer } from 'buffer';
import type { Backend, BackendResult, TxResult } from './backendInterface';
import type { SessionState, ChadCommand } from '../model';
import type { ChainConfig } from './config';
import type { ContractSigner } from '@/types/signer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { TxQueue } from './txQueue';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

import { Client as ProofOfLifeClient, Role as ChainRole, type Session as ChainSession } from '@/bindings/proof_of_life';

// Bindings are generated from the deployed contract spec. When the contract evolves,
// the repo may temporarily compile against older bindings until `bun run bindings proof-of-life`
// is re-run. Keep these calls type-loose to avoid blocking frontend builds.
export type ChainTowers = {
  n_x: number;
  n_y: number;
  e_x: number;
  e_y: number;
  s_x: number;
  s_y: number;
  w_x: number;
  w_y: number;
};

const WRITE_MAX_ATTEMPTS = 5;
const WRITE_BASE_BACKOFF_MS = 800;
const CHAIN_DEBUG = String((import.meta as any)?.env?.VITE_CHAIN_DEBUG ?? '').toLowerCase() === 'true';
export const SESSION_ALLOW_DISPATCH = 1 << 0;
export const SESSION_ALLOW_RECHARGE = 1 << 1;
export const SESSION_ALLOW_COMMIT_LOCATION = 1 << 2;
export const SESSION_ALLOW_SUBMIT_PING_PROOF = 1 << 3;
export const SESSION_ALLOW_SUBMIT_MOVE_PROOF = 1 << 4;
export const SESSION_ALLOW_SUBMIT_TURN_STATUS_PROOF = 1 << 5;
export const SESSION_ALLOW_ASSASSIN_TICK = 1 << 6;
export const SESSION_ALLOW_LOCK_SECURE_MODE = 1 << 7;
export type SessionRole = 'Dispatcher' | 'Assassin';
export type SessionKeyScopeView = {
  owner: string;
  delegate: string;
  session_id: number;
  role: SessionRole | string;
  expires_ledger: number;
  max_writes: number;
  writes_used: number;
  allow_mask: number;
};

/**
 * Chain backend - executes transactions on Soroban
 */
export class ChainBackend implements Backend {
  private config: ChainConfig;
  private client: ProofOfLifeClient;
  private txq = new TxQueue();
  /** When using a session key, this is the delegate's public key (used as the actor in auth calls). */
  readonly actorPublicKey: string;

  constructor(config: ChainConfig, signer: ContractSigner, publicKey: string) {
    this.config = config;
    this.actorPublicKey = publicKey;

    if (!publicKey) {
      throw new Error('ChainBackend requires publicKey (source account) for state-changing transactions');
    }

    this.client = new ProofOfLifeClient({
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey,
      // Required for state-changing invocations.
      signTransaction: signer.signTransaction,
      signAuthEntry: signer.signAuthEntry,
    });
  }

  async startGame(params: {
    sessionId: number;
    dispatcher: string;
    assassin: string;
    dispatcherPoints?: bigint;
    assassinPoints?: bigint;
  }): Promise<BackendResult> {
    if (!params.dispatcher.startsWith('G') || params.dispatcher.length !== 56) {
      const msg = `CRITICAL ERROR: Invalid Dispatcher Address: "${params.dispatcher}"`;
      console.error(msg);
      throw new Error(msg);
    }
    if (!params.assassin.startsWith('G') || params.assassin.length !== 56) {
      const msg = `CRITICAL ERROR: Invalid Assassin Address: "${params.assassin}"`;
      console.error(msg);
      throw new Error(msg);
    }

    try {
      // start_game already initializes runtime (runtime_initialized: true).
      const startRes = await this.write(() =>
        this.client.start_game({
          session_id: params.sessionId >>> 0,
          dispatcher: params.dispatcher,
          assassin: params.assassin,
          alpha_max: BigInt(5),
          strong_radius_sq: BigInt(4),
        })
      );

      return { success: true, txHash: startRes.txHash };
    } catch (e: any) {
      console.error('start_game failed', e);
      throw e;
    }
  }

  async startGameWithSessionKey(params: {
    sessionId: number;
    dispatcher: string;
    assassin: string;
    insecureMode: boolean;
    delegate: string;
    ttlLedgers: number;
    maxWrites: number;
    dispatcherAllowMask: number;
    assassinAllowMask: number;
  }): Promise<BackendResult> {
    if (!params.dispatcher.startsWith('G') || params.dispatcher.length !== 56) {
      throw new Error(`CRITICAL ERROR: Invalid Dispatcher Address: "${params.dispatcher}"`);
    }
    if (!params.assassin.startsWith('G') || params.assassin.length !== 56) {
      throw new Error(`CRITICAL ERROR: Invalid Assassin Address: "${params.assassin}"`);
    }
    // Use the atomic start_game_with_session_key (1 txn → 1 wallet popup).
    // Falls back to start_game + authorize_session_key if the combined function isn't in bindings yet.
    const combinedFn = (this.client as any).start_game_with_session_key;
    let startRes: any;
    if (typeof combinedFn === 'function') {
      startRes = await this.write(() =>
        combinedFn.call(this.client, {
          session_id: params.sessionId >>> 0,
          dispatcher: params.dispatcher,
          assassin: params.assassin,
          sk_params: {
            delegate: params.delegate,
            ttl_ledgers: params.ttlLedgers >>> 0,
            max_writes: params.maxWrites >>> 0,
            dispatcher_allow_mask: params.dispatcherAllowMask >>> 0,
            assassin_allow_mask: params.assassinAllowMask >>> 0,
          },
        })
      );
    } else {
      // Fallback: 2 txns if bindings don't have start_game_with_session_key yet.
      startRes = await this.write(() =>
        this.client.start_game({
          session_id: params.sessionId >>> 0,
          dispatcher: params.dispatcher,
          assassin: params.assassin,
          alpha_max: BigInt(5),
          strong_radius_sq: BigInt(4),
        })
      );
      await this.write(() =>
        this.client.authorize_session_key({
          owner: params.dispatcher,
          session_id: params.sessionId >>> 0,
          delegate: params.delegate,
          ttl_ledgers: params.ttlLedgers >>> 0,
          max_writes: params.maxWrites >>> 0,
          dispatcher_allow_mask: params.dispatcherAllowMask >>> 0,
          assassin_allow_mask: params.assassinAllowMask >>> 0,
        })
      );
    }
    // Enable insecure_mode when requested (requires admin auth, same as setInsecureMode).
    if (params.insecureMode) {
      await this.setInsecureMode({ sessionId: params.sessionId, enabled: true });
    }
    return { success: true, txHash: startRes.txHash };
  }

  async lockSecureMode(params: { sessionId: number; dispatcher: string }): Promise<BackendResult> {
    const res = await this.write(() =>
      this.client.lock_secure_mode({
        session_id: params.sessionId >>> 0,
        dispatcher: params.dispatcher,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async authorizeSessionKey(params: {
    owner: string;
    sessionId: number;
    delegate: string;
    ttlLedgers: number;
    maxWrites: number;
    dispatcherAllowMask: number;
    assassinAllowMask: number;
  }): Promise<BackendResult> {
    const res = await this.write(() =>
      (this.client as any).authorize_session_key({
        owner: params.owner,
        session_id: params.sessionId >>> 0,
        delegate: params.delegate,
        ttl_ledgers: params.ttlLedgers >>> 0,
        max_writes: params.maxWrites >>> 0,
        dispatcher_allow_mask: params.dispatcherAllowMask >>> 0,
        assassin_allow_mask: params.assassinAllowMask >>> 0,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async revokeSessionKey(params: { owner: string; sessionId: number; role: SessionRole }): Promise<BackendResult> {
    const role = { tag: params.role, values: undefined };
    const res = await this.write(() =>
      (this.client as any).revoke_session_key({
        owner: params.owner,
        session_id: params.sessionId >>> 0,
        role,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async setInsecureMode(params: { sessionId: number; enabled: boolean }): Promise<BackendResult> {
    const rawAdminSecret = String(import.meta.env.VITE_DEV_ADMIN_SECRET ?? '').trim();
    const adminSecret = rawAdminSecret.replace(/^['"]|['"]$/g, '');
    
    // If admin secret is available, use it to bypass the connected user wallet
    if (adminSecret && adminSecret.startsWith('S')) {
      try {
        const kp = Keypair.fromSecret(adminSecret);
        const adminClient = new ProofOfLifeClient({
          ...this.config,
          publicKey: kp.publicKey(),
          signTransaction: async (xdr: string) => {
            const tx = TransactionBuilder.fromXDR(xdr, this.config.networkPassphrase);
            tx.sign(kp);
            return {
              signedTxXdr: tx.toXDR(),
              signerAddress: kp.publicKey(),
            };
          },
          signAuthEntry: async (xdr: string) => ({
            signedAuthEntry: xdr,
            signerAddress: kp.publicKey(),
          }),
        });
        
        const txResult = await this.txq.enqueue(async () => {
          const tx = await adminClient.set_insecure_mode({
            session_id: params.sessionId >>> 0,
            enabled: params.enabled,
          });
          const sent = await tx.signAndSend();
          await ensureSentTransactionSucceeded(sent);
          const hash = await tryExtractTxHash(sent);
          return { txHash: hash ?? 'UNKNOWN' };
        });
        return { success: true, txHash: txResult.txHash };
      } catch (e: any) {
        console.error('Admin setInsecureMode failed:', e);
        throw e;
      }
    }

    // Fallback for production or missing admin secret (likely to fail auth if not admin)
    const res = await this.write(() =>
      (this.client as any).set_insecure_mode({
        session_id: params.sessionId >>> 0,
        enabled: params.enabled,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async getSession(sessionId: number): Promise<SessionState> {
    const tx = await this.client.get_session({ session_id: sessionId >>> 0 });
    const sim = await tx.simulate();
    // DEBUG: Temporarily expose the raw simulation result to finding the binding mismatch
    if ((sim as any).error) { 
        throw new Error(`Simulation failed: ${JSON.stringify((sim as any).error)}`);
    }
    const res = sim.result as any;
    
    // The binding returns Result<Session, Error>, so we must unwrap it.
    // Standard Soroban binding Result shape: { tag: "Ok", values: [T] } | { tag: "Err", values: [E] }
    if (res && res.tag === 'Ok' && Array.isArray(res.values)) {
      const out = unwrapSessionValue(res.values[0]) as ChainSession;
      return mapChainSessionToState(out);
    }
    if (res && res.tag === 'Err') {
      throw new Error(`get_session on-chain error: ${JSON.stringify(res.values)}`);
    }
    
    // Fallback: some runtime paths return `{ value: Session }` directly.
    const direct = unwrapSessionValue(res);
    if (direct) {
      return mapChainSessionToState(direct as ChainSession);
    }

    // Fallback: if it's not a Result (e.g. old bindings?) or unwrap failed
    throw new Error(`get_session returned unexpected shape: ${JSON.stringify(res)} / Full Sim: ${JSON.stringify(sim)}`);
  }

  async getSessionKeyScope(params: { owner: string; sessionId: number; role: SessionRole }): Promise<SessionKeyScopeView | null> {
    const roleArg = params.role === 'Dispatcher' ? ChainRole.Dispatcher : ChainRole.Assassin;
    const tx = await (this.client as any).get_session_key_scope({
      owner: params.owner,
      session_id: params.sessionId >>> 0,
      role: roleArg,
    });
    const sim = await tx.simulate();
    if ((sim as any).error) {
      throw new Error(`get_session_key_scope simulate failed: ${JSON.stringify((sim as any).error)}`);
    }
    const res = (sim as any).result;

    const unwrapOption = (v: any): any | null => {
      if (!v) return null;
      if (v.tag === 'Some' && Array.isArray(v.values)) return v.values[0] ?? null;
      if (v.tag === 'None') return null;
      if (v.tag === 'Ok' && Array.isArray(v.values)) return unwrapOption(v.values[0]);
      if (v.tag === 'Err') throw new Error(`get_session_key_scope on-chain error: ${JSON.stringify(v.values)}`);
      return v;
    };

    const out = unwrapOption(res);
    if (!out) return null;
    return out as SessionKeyScopeView;
  }

  async dispatcherCommand(params: {
    sessionId: number;
    dispatcher: string;
    command: ChadCommand;
  }): Promise<BackendResult> {
    const command = this.mapChadCommand(params.command);
    const actor = this.actorPublicKey || params.dispatcher;
    const res = await this.write(() =>
      this.client.dispatcher_command({
        session_id: params.sessionId >>> 0,
        dispatcher: actor,
        command,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  // Combined dispatcher action (ping cost) + Chad command.
  // This matches the current on-chain turn model better than `request_ping` + `dispatcher_command`.
  async dispatch(params: {
    sessionId: number;
    dispatcher: string;
    towerId: number;
    command: ChadCommand;
  }): Promise<BackendResult> {
    const command = this.mapChadCommand(params.command);
    // Use actorPublicKey as the dispatcher so require_owner_or_delegate routes via the session key
    // delegate path when a session key is active, rather than demanding the owner's signature.
    const actor = this.actorPublicKey || params.dispatcher;
    const res = await this.write(() =>
      this.client.dispatch({
        session_id: params.sessionId >>> 0,
        dispatcher: actor,
        tower_id: params.towerId >>> 0,
        command,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async assassinTick(params: {
    sessionId: number;
    assassin: string;
    d2Chad: number;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.assassin;
    const res = await this.write(() =>
      this.client.assassin_tick({
        session_id: params.sessionId >>> 0,
        assassin: actor,
        d2_chad: params.d2Chad >>> 0,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  // Keep request_ping available, but it is not used by the current UI in shadow mode.

  async requestPing(params: {
    sessionId: number;
    dispatcher: string;
    towerId: number;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.dispatcher;
    const res = await this.write(() =>
      this.client.request_ping({
        session_id: params.sessionId >>> 0,
        dispatcher: actor,
        tower_id: params.towerId >>> 0,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async recharge(params: {
    sessionId: number;
    dispatcher: string;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.dispatcher;
    const res = await this.write(() =>
      this.client.recharge({
        session_id: params.sessionId >>> 0,
        dispatcher: actor,
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async rechargeWithCommand(params: {
    sessionId: number;
    dispatcher: string;
    command: ChadCommand;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.dispatcher;
    const command = this.mapChadCommand(params.command);
    const fn = (this.client as any).recharge_with_command;
    if (typeof fn === 'function') {
      const res = await this.write(() =>
        fn.call(this.client, {
          session_id: params.sessionId >>> 0,
          dispatcher: actor,
          command,
        })
      );
      return { success: true, txHash: res.txHash };
    }

    if (params.command !== 'STAY') {
      throw new Error('recharge_with_command is not available on the deployed contract; recharge + command sync is unsupported');
    }

    return this.recharge({ sessionId: params.sessionId, dispatcher: params.dispatcher });
  }

  async commitLocation(params: {
    sessionId: number;
    assassin: string;
    commitment: string;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.assassin;
    const res = await this.write(() =>
      this.client.commit_location({
        session_id: params.sessionId >>> 0,
        assassin: actor,
        commitment: hexToBuf32(params.commitment),
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async submitPingProof(params: {
    sessionId: number;
    assassin: string;
    towerId: number;
    d2: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult<number>> {
    const actor = this.actorPublicKey || params.assassin;
    const res = await this.write(() =>
      this.client.submit_ping_proof({
        session_id: params.sessionId >>> 0,
        assassin: actor,
        tower_id: params.towerId >>> 0,
        d2: params.d2 >>> 0,
        proof: Buffer.from(params.proof),
        public_inputs: params.publicInputs.map(hexToBuf32),
      })
    );
    return { success: true, data: params.d2, txHash: res.txHash };
  }

  async submitMoveProof(params: {
    sessionId: number;
    assassin: string;
    newCommitment: string;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.assassin;
    const res = await this.write(() =>
      this.client.submit_move_proof({
        session_id: params.sessionId >>> 0,
        assassin: actor,
        new_commitment: hexToBuf32(params.newCommitment),
        proof: Buffer.from(params.proof),
        public_inputs: params.publicInputs.map(hexToBuf32),
      })
    );
    return { success: true, txHash: res.txHash };
  }

  async submitMultiMoveProof(params: {
    sessionId: number;
    assassin: string;
    entries: Array<{
      newCommitment: string;
      proof: Uint8Array;
      publicInputs: string[];
    }>;
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.assassin;
    const entriesVec = params.entries.map((e) => ({
      new_commitment: hexToBuf32(e.newCommitment),
      proof: Buffer.from(e.proof),
      public_inputs: e.publicInputs.map(hexToBuf32),
    }));
    const submitFn = (this.client as any).submit_multi_move_proof;
    if (typeof submitFn === 'function') {
      try {
        const res = await this.write(() =>
          submitFn.call(this.client, {
            session_id: params.sessionId >>> 0,
            assassin: actor,
            entries: entriesVec,
          })
        );
        return { success: true, txHash: res.txHash };
      } catch (err) {
        // UltraHonk verifier + multiple move proofs can exceed Soroban sim budget on long HIDE paths.
        // Split and retry recursively so the UI can continue without forcing a contract change.
        if (params.entries.length > 1 && isOversizedMultiMoveBatchError(err)) {
          const mid = Math.ceil(params.entries.length / 2);
          let lastHash = 'UNKNOWN';
          const left = await this.submitMultiMoveProof({
            sessionId: params.sessionId,
            assassin: params.assassin,
            entries: params.entries.slice(0, mid),
          });
          lastHash = left.txHash ?? lastHash;
          const right = await this.submitMultiMoveProof({
            sessionId: params.sessionId,
            assassin: params.assassin,
            entries: params.entries.slice(mid),
          });
          lastHash = right.txHash ?? lastHash;
          return { success: true, txHash: lastHash };
        }
        throw err;
      }
    }
    // Fallback: submit one at a time if bindings don't have submit_multi_move_proof.
    let lastHash = 'UNKNOWN';
    for (const entry of params.entries) {
      const res = await this.submitMoveProof({
        sessionId: params.sessionId,
        assassin: params.assassin,
        newCommitment: entry.newCommitment,
        proof: entry.proof,
        publicInputs: entry.publicInputs,
      });
      lastHash = res.txHash ?? lastHash;
    }
    return { success: true, txHash: lastHash };
  }

  async submitTurnStatusProof(params: {
    sessionId: number;
    assassin: string;
    d2Chad: number;
    proof: Uint8Array;
    publicInputs: string[];
  }): Promise<BackendResult> {
    const actor = this.actorPublicKey || params.assassin;
    const res = await this.write(() =>
      this.client.submit_turn_status_proof({
        session_id: params.sessionId >>> 0,
        assassin: actor,
        d2_chad: params.d2Chad >>> 0,
        proof: Buffer.from(params.proof),
        public_inputs: params.publicInputs.map(hexToBuf32),
      })
    );
    return { success: true, txHash: res.txHash };
  }

  // Extra inspection helpers (used by the chain terminal UI)
  async getVerifiers(): Promise<readonly [string, string, string]> {
    const tx = await this.client.get_verifiers();
    const sim = await tx.simulate();
    return sim.result as any;
  }

  async getTowers(): Promise<ChainTowers> {
    const tx = await this.client.get_towers();
    const sim = await tx.simulate();
    return sim.result as any;
  }

  private mapChadCommand(cmd: ChadCommand): any {
    return mapChadCommandToChain(cmd);
  }

  private async write(buildTx: () => Promise<any>): Promise<TxResult> {
    // IMPORTANT: queue the *construction/simulation/sign/send* together.
    // If we build two AssembledTransactions concurrently, they can embed the same
    // source-account sequence number and later fail with txBadSeq even if we send
    // them sequentially.
    return this.txq.enqueue(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < WRITE_MAX_ATTEMPTS; attempt++) {
        try {
          const tx = await buildTx();
          // Escalate Soroban resource bump factor across write retries.
          const sent = await signAndSendViaLaunchtube(tx, 30, undefined, attempt);
          if (CHAIN_DEBUG) {
            const sendResp = (sent as any)?.sendTransactionResponse;
            const sendStatus = sendResp?.status ?? 'NO_SEND_RESP';
            const sendHash = sendResp?.hash ?? (sent as any)?.hash ?? 'NO_HASH';
            console.info(`[write] sendStatus=${sendStatus} hash=${sendHash}`, sendResp);
          }
          await ensureSentTransactionSucceeded(sent);
          const txHash = await tryExtractTxHash(sent);
          return { txHash: txHash ?? 'UNKNOWN', events: undefined };
        } catch (err) {
          lastErr = err;
          // txBadAuth is usually non-retriable, but on testnet we occasionally see
          // transient wallet/relay auth glitches. Give it one clean rebuild+resign retry.
          const isAuthGlitch = isTxBadAuthError(err);
          const maxAttemptsForThisError = isAuthGlitch ? Math.min(WRITE_MAX_ATTEMPTS, 2) : WRITE_MAX_ATTEMPTS;
          const canRetry =
            (isAuthGlitch || isRetriableWriteError(err)) &&
            attempt < maxAttemptsForThisError - 1;
          if (!canRetry) throw err;
          const delayMs = WRITE_BASE_BACKOFF_MS * 2 ** attempt;
          await sleep(delayMs);
        }
      }
      throw lastErr ?? new Error('write failed with unknown error');
    });
  }
}

// Stable room id mapping for the current contract interface (GoRoom(u32)).
// NOTE: The on-chain `GoRoom` behavior is still a stub; this mapping is used
// to avoid runtime errors in shadow mode and will become canonical once the
// full on-chain movement model is finalized.
export function roomIdForChadCommand(cmd: ChadCommand): number | null {
  switch (cmd) {
    case 'GO_GARDEN':
      return 0;
    case 'GO_HALLWAY':
      return 1;
    case 'GO_LIVING':
      return 2;
    case 'GO_STUDY':
      return 3;
    case 'GO_LIBRARY':
      return 4;
    case 'GO_DINING':
      return 5;
    case 'GO_KITCHEN':
      return 6;
    case 'GO_GRAND_HALL':
      return 7;
    default:
      return null;
  }
}

export function mapChadCommandToChain(cmd: ChadCommand): any {
  switch (cmd) {
    case 'STAY':
      return { tag: 'Stay', values: undefined };
    case 'HIDE':
      return { tag: 'Hide', values: undefined };
    case 'WALK_N':
      return { tag: 'WalkGarden', values: [0] };
    case 'WALK_E':
      return { tag: 'WalkGarden', values: [1] };
    case 'WALK_S':
      return { tag: 'WalkGarden', values: [2] };
    case 'WALK_W':
      return { tag: 'WalkGarden', values: [3] };
    default: {
      const roomId = roomIdForChadCommand(cmd);
      if (roomId !== null) return { tag: 'GoRoom', values: [roomId] };
      throw new Error(`Unsupported command: ${cmd}`);
    }
  }
}

export function mapChainSessionToState(s: ChainSession): SessionState {
  return {
    sessionId: s.session_id,
    mode: 'single',
    dispatcher: s.dispatcher,
    assassin: s.assassin,
    commitmentSet: !!s.commitment,
    battery: s.battery,
    pingCost: s.ping_cost,
    rechargeAmount: s.recharge_amount,
    turn: s.turn,
    phase: normalizeTurnPhase((s as any).phase),
    turn_step: 'action',
    ended: s.ended,
    log: [],
    moved_this_turn: s.moved_this_turn,
    alpha: s.alpha,
    alpha_max: s.alpha_max,
    chad_x: s.chad_x,
    chad_y: s.chad_y,
    chad_hidden: s.chad_hidden,
    chad_hide_streak: s.chad_hide_streak,
    pending_ping_tower: s.pending_ping_tower ?? null,
    insecure_mode: s.insecure_mode,
  };
}

function normalizeTurnPhase(raw: any): 'dispatcher' | 'assassin' {
  if (raw === 0 || raw === '0') return 'dispatcher';
  if (raw === 1 || raw === '1') return 'assassin';
  if (typeof raw === 'string') {
    const r = raw.toLowerCase();
    if (r.includes('dispatcher')) return 'dispatcher';
    if (r.includes('assassin')) return 'assassin';
  }
  if (raw && typeof raw === 'object') {
    const tag = String((raw as any).tag ?? (raw as any)._tag ?? '').toLowerCase();
    if (tag.includes('dispatcher')) return 'dispatcher';
    if (tag.includes('assassin')) return 'assassin';
    const val = (raw as any).value ?? (raw as any).values?.[0];
    if (val === 0 || val === '0') return 'dispatcher';
    if (val === 1 || val === '1') return 'assassin';
  }
  // Fail closed to dispatcher (safer for proof-submission guards).
  return 'dispatcher';
}

function unwrapSessionValue(input: any): any {
  if (!input || typeof input !== 'object') return null;
  if (input.value && typeof input.value === 'object') return input.value;
  if ('session_id' in input && 'dispatcher' in input && 'assassin' in input) return input;
  return null;
}

export function hexToBuf32(hex: string): Buffer {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buf = Buffer.from(h, 'hex');
  if (buf.length !== 32) {
    throw new Error(`expected 32-byte hex, got ${buf.length} bytes`);
  }
  return buf;
}

export async function tryExtractTxHash(sent: any): Promise<string | undefined> {
  // `signAndSend` returns a SentTransaction. When it really submits, it should
  // expose a transaction response.
  try {
    // If send failed, SentTransaction keeps the sendTransactionResponse with hash.
    const sendResp = sent?.sendTransactionResponse;
    const sendHash = sendResp?.hash ?? sent?.hash;
    if (typeof sendHash === 'string' && sendHash) return sendHash;

    const getTxResponse = sent?.getTransactionResponse;
    if (typeof getTxResponse === 'function') {
      const resp = await getTxResponse.call(sent);
      const hash = resp?.hash ?? resp?.txHash ?? resp?.id;
      if (typeof hash === 'string' && hash) return hash;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function tryExtractTxHashFromError(err: unknown): string | undefined {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const idx = msg.indexOf('{');
  if (idx < 0) return undefined;
  try {
    const parsed = JSON.parse(msg.slice(idx));
    const hash = parsed?.hash ?? parsed?.txHash ?? parsed?.id;
    return typeof hash === 'string' && hash ? hash : undefined;
  } catch {
    return undefined;
  }
}

function isTxBadSeqError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /txBadSeq/i.test(msg);
}

function isTxBadAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /txBadAuth/i.test(msg);
}

function isSessionNotFoundContractError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Error\(Contract,\s*#1\)/i.test(msg);
}

function isBudgetExceededSimulationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Error\(Budget,\s*ExceededLimit\)/i.test(msg)
    || /HostError:\s*Error\(Budget,\s*ExceededLimit\)/i.test(msg)
    || (/ExceededLimit/i.test(msg) && /simulation failed/i.test(msg));
}

function isTxMalformedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /txMalformed/i.test(msg)
    || (/transaction to the network failed/i.test(msg) && /malformed/i.test(msg));
}

function isOversizedMultiMoveBatchError(err: unknown): boolean {
  return isBudgetExceededSimulationError(err) || isTxMalformedError(err);
}

function isResourceLimitExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /ResourceLimitExceeded/i.test(msg)
    || /resource_limit_exceeded/i.test(msg)
    || /scecExceededLimit/i.test(msg)
    || /txSorobanInvalid/i.test(msg)
    || /resourceFee/i.test(msg)
    || /resource fee/i.test(msg)
    || msg.includes('tx_insufficient_fee');
}

function isRetriableWriteError(err: unknown): boolean {
  return isTxBadSeqError(err) || isSessionNotFoundContractError(err) || isResourceLimitExceededError(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAcceptedSubmissionStatus(statusRaw: unknown): boolean {
  const status = String(statusRaw ?? '').toUpperCase();
  return status === 'SUCCESS' || status === 'PENDING' || status === 'DUPLICATE';
}

export async function ensureSentTransactionSucceeded(sent: any): Promise<void> {
  const sendResp = sent?.sendTransactionResponse;
  if (sendResp) {
    const sendStatus = String(sendResp?.status ?? '').toUpperCase();
    if (sendStatus === 'ERROR' || sendResp?.errorResult) {
      const summary = {
        status: sendResp?.status,
        hash: sendResp?.hash ?? sendResp?.txHash ?? sendResp?.id,
        latestLedger: sendResp?.latestLedger,
        latestLedgerCloseTime: sendResp?.latestLedgerCloseTime,
        errorResult: sendResp?.errorResult,
      };
      throw new Error(`Transaction failed during submission: ${JSON.stringify(summary)}`);
    }
  }

  // getTransactionResponse can be a property (object) or a method (function) depending
  // on SDK version. Handle both cases.
  const getTxResponse = sent?.getTransactionResponse;
  let resp: any;
  if (typeof getTxResponse === 'function') {
    resp = await getTxResponse.call(sent);
  } else if (getTxResponse && typeof getTxResponse === 'object') {
    // SDK v12+ exposes it as a property containing the final response
    resp = getTxResponse;
  }

  if (resp) {
    const status = String(resp?.status ?? '').toUpperCase();
    const hasErrorResult = !!resp?.errorResult;
    // Explicitly detect FAILED / NOT_FOUND / error statuses
    if (hasErrorResult || status === 'FAILED' || status === 'NOT_FOUND') {
      const summary = {
        status: resp?.status,
        hash: resp?.hash ?? resp?.txHash ?? resp?.id ?? sendResp?.hash,
        latestLedger: resp?.latestLedger,
        latestLedgerCloseTime: resp?.latestLedgerCloseTime,
        errorResult: resp?.errorResult,
        resultXdr: resp?.resultXdr,
      };
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(summary)}`);
    }
    if (isAcceptedSubmissionStatus(status)) return;
    if (!status) return;
    // Unknown status — still throw
    const summary = {
      status: resp?.status,
      hash: resp?.hash ?? resp?.txHash ?? resp?.id,
      errorResult: resp?.errorResult,
    };
    throw new Error(`Transaction returned unexpected status: ${JSON.stringify(summary)}`);
  }

  // No final response available — check if the transaction was at least submitted
  if (isAcceptedSubmissionStatus(sendResp?.status)) {
    // PENDING means we can't confirm success. Log a warning.
    const sendStatus = String(sendResp?.status ?? '').toUpperCase();
    if (sendStatus === 'PENDING') {
      console.warn('[tx] Transaction accepted as PENDING but final status unknown — may have failed on-chain');
    }
    return;
  }

  const summary = {
    status: sendResp?.status,
    hash: sendResp?.hash ?? sendResp?.txHash ?? sendResp?.id,
  };
  throw new Error(`Transaction final status unavailable: ${JSON.stringify(summary)}`);
}
