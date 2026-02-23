import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDDAF3TG5QR5FDZXMFJI2ZTYOHQAPDOU3Z63TTZQVSVEA5X6RIKQESJB",
  }
} as const

export enum Role {
  Dispatcher = 0,
  Assassin = 1,
}

export const Errors = {
  1: {message:"SessionNotFound"},
  2: {message:"GameAlreadyEnded"},
  3: {message:"CommitmentNotSet"},
  4: {message:"NotDispatcher"},
  5: {message:"NotAssassin"},
  6: {message:"NotDispatcherTurn"},
  7: {message:"NotAssassinTurn"},
  8: {message:"BatteryTooLow"},
  9: {message:"NotAdmin"},
  10: {message:"PendingPingExists"},
  11: {message:"NoPendingPing"},
  12: {message:"UnexpectedTower"},
  13: {message:"ProofVerificationUnsupported"},
  14: {message:"AlreadyMovedThisTurn"},
  15: {message:"InvalidMove"},
  16: {message:"InvalidHide"},
  17: {message:"InvalidRoomTransition"},
  18: {message:"ProofSessionMismatch"},
  19: {message:"ProofTurnMismatch"},
  20: {message:"CommitmentMismatch"},
  21: {message:"VerifierNotSet"},
  22: {message:"InvalidProof"},
  23: {message:"D2Mismatch"},
  24: {message:"D2ChadMismatch"},
  25: {message:"ChadCoordMismatch"},
  26: {message:"AssassinMustMove"},
  27: {message:"RuntimeNotInitialized"},
  28: {message:"SessionKeyNotAuthorized"},
  29: {message:"SessionKeyExpired"},
  30: {message:"SessionKeyMethodNotAllowed"},
  31: {message:"SessionKeyWriteLimitExceeded"},
  32: {message:"SessionKeyRoleMismatch"}
}


export interface Towers {
  e_x: u32;
  e_y: u32;
  n_x: u32;
  n_y: u32;
  s_x: u32;
  s_y: u32;
  w_x: u32;
  w_y: u32;
}

export type DataKey = {tag: "Admin", values: void} | {tag: "GameHub", values: void} | {tag: "Towers", values: void} | {tag: "SessionCore", values: readonly [u32]} | {tag: "SessionRuntime", values: readonly [u32]} | {tag: "PingVerifier", values: void} | {tag: "TurnStatusVerifier", values: void} | {tag: "MoveVerifier", values: void} | {tag: "SessionKeyScope", values: readonly [u32, string, u32]};


export interface Session {
  alpha: u32;
  alpha_max: u32;
  assassin: string;
  assassin_moves_this_turn: u32;
  battery: u32;
  chad_hidden: boolean;
  chad_hide_streak: u32;
  chad_x: u32;
  chad_y: u32;
  commitment: Option<Buffer>;
  d2: Option<u32>;
  d2_chad: Option<u32>;
  dispatcher: string;
  ended: boolean;
  insecure_mode: boolean;
  moved_this_turn: boolean;
  pending_ping_tower: Option<u32>;
  phase: TurnPhase;
  ping_cost: u32;
  recharge_amount: u32;
  session_id: u32;
  strong_radius_sq: u32;
  turn: u32;
}

export enum TurnPhase {
  Dispatcher = 0,
  Assassin = 1,
}

export type ChadCommand = {tag: "Stay", values: void} | {tag: "Hide", values: void} | {tag: "GoRoom", values: readonly [u32]} | {tag: "WalkGarden", values: readonly [u32]};


export interface SessionCore {
  alpha_max: u32;
  assassin: string;
  commitment: Option<Buffer>;
  dispatcher: string;
  init_chad_x: u32;
  init_chad_y: u32;
  insecure_mode: boolean;
  runtime_initialized: boolean;
  session_id: u32;
  strong_radius_sq: u32;
}


export interface SessionRuntime {
  alpha: u32;
  assassin_moves_this_turn: u32;
  battery: u32;
  chad_hidden: boolean;
  chad_hide_streak: u32;
  chad_x: u32;
  chad_y: u32;
  ended: boolean;
  moved_this_turn: boolean;
  pending_ping_tower: Option<u32>;
  phase: TurnPhase;
  turn: u32;
}


export interface SessionKeyScope {
  allow_mask: u32;
  delegate: string;
  expires_ledger: u32;
  max_writes: u32;
  owner: string;
  role: Role;
  session_id: u32;
  writes_used: u32;
}

export interface Client {
  /**
   * Construct and simulate a hide transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  hide: ({session_id, commitment}: {session_id: u32, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a dispatch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  dispatch: ({session_id, dispatcher, tower_id, command}: {session_id: u32, dispatcher: string, tower_id: u32, command: ChadCommand}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recharge transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recharge: ({session_id, dispatcher}: {session_id: u32, dispatcher: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_towers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_towers: (options?: MethodOptions) => Promise<AssembledTransaction<Towers>>

  /**
   * Construct and simulate a set_towers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_towers: ({towers}: {towers: Towers}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game: ({session_id, dispatcher, assassin, alpha_max, strong_radius_sq}: {session_id: u32, dispatcher: string, assassin: string, alpha_max: i128, strong_radius_sq: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Session>>>

  /**
   * Construct and simulate a get_game_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a request_ping transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  request_ping: ({session_id, dispatcher, tower_id}: {session_id: u32, dispatcher: string, tower_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a assassin_tick transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  assassin_tick: ({session_id, assassin, d2_chad}: {session_id: u32, assassin: string, d2_chad: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifiers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifiers: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [string, string, string]>>

  /**
   * Construct and simulate a set_verifiers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifiers: ({ping_v, turn_v, move_v}: {ping_v: string, turn_v: string, move_v: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game_ext transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_game_ext: ({session_id, dispatcher, assassin, chad_x, chad_y, alpha_max, strong_radius_sq}: {session_id: u32, dispatcher: string, assassin: string, chad_x: u32, chad_y: u32, alpha_max: u32, strong_radius_sq: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a commit_location transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_location: ({session_id, assassin, commitment}: {session_id: u32, assassin: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a lock_secure_mode transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Dispatcher can permanently lock a session into secure mode.
   * This is safe because it only allows disabling insecure mode (never enabling it).
   */
  lock_secure_mode: ({session_id, dispatcher}: {session_id: u32, dispatcher: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_insecure_mode transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_insecure_mode: ({session_id, enabled}: {session_id: u32, enabled: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_move_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_move_proof: ({session_id, assassin, new_commitment, proof, public_inputs}: {session_id: u32, assassin: string, new_commitment: Buffer, proof: Buffer, public_inputs: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_ping_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_ping_proof: ({session_id, assassin, tower_id, d2, proof, public_inputs}: {session_id: u32, assassin: string, tower_id: u32, d2: u32, proof: Buffer, public_inputs: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a dispatcher_command transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  dispatcher_command: ({session_id, dispatcher, command}: {session_id: u32, dispatcher: string, command: ChadCommand}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_session_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_session_key: ({owner, session_id, role}: {owner: string, session_id: u32, role: Role}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a authorize_session_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  authorize_session_key: ({owner, session_id, delegate, ttl_ledgers, max_writes, dispatcher_allow_mask, assassin_allow_mask}: {owner: string, session_id: u32, delegate: string, ttl_ledgers: u32, max_writes: u32, dispatcher_allow_mask: u32, assassin_allow_mask: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session_key_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_session_key_scope: ({owner, session_id, role}: {owner: string, session_id: u32, role: Role}, options?: MethodOptions) => Promise<AssembledTransaction<Option<SessionKeyScope>>>

  /**
   * Construct and simulate a submit_turn_status_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_turn_status_proof: ({session_id, assassin, d2_chad, proof, public_inputs}: {session_id: u32, assassin: string, d2_chad: u32, proof: Buffer, public_inputs: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a initialize_session_runtime transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize_session_runtime: ({session_id, dispatcher}: {session_id: u32, dispatcher: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub}: {admin: string, game_hub: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAwAAAAAAAAAAAAAABFJvbGUAAAACAAAAAAAAAApEaXNwYXRjaGVyAAAAAAAAAAAAAAAAAAhBc3Nhc3NpbgAAAAE=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAIAAAAAAAAAAPU2Vzc2lvbk5vdEZvdW5kAAAAAAEAAAAAAAAAEEdhbWVBbHJlYWR5RW5kZWQAAAACAAAAAAAAABBDb21taXRtZW50Tm90U2V0AAAAAwAAAAAAAAANTm90RGlzcGF0Y2hlcgAAAAAAAAQAAAAAAAAAC05vdEFzc2Fzc2luAAAAAAUAAAAAAAAAEU5vdERpc3BhdGNoZXJUdXJuAAAAAAAABgAAAAAAAAAPTm90QXNzYXNzaW5UdXJuAAAAAAcAAAAAAAAADUJhdHRlcnlUb29Mb3cAAAAAAAAIAAAAAAAAAAhOb3RBZG1pbgAAAAkAAAAAAAAAEVBlbmRpbmdQaW5nRXhpc3RzAAAAAAAACgAAAAAAAAANTm9QZW5kaW5nUGluZwAAAAAAAAsAAAAAAAAAD1VuZXhwZWN0ZWRUb3dlcgAAAAAMAAAAAAAAABxQcm9vZlZlcmlmaWNhdGlvblVuc3VwcG9ydGVkAAAADQAAAAAAAAAUQWxyZWFkeU1vdmVkVGhpc1R1cm4AAAAOAAAAAAAAAAtJbnZhbGlkTW92ZQAAAAAPAAAAAAAAAAtJbnZhbGlkSGlkZQAAAAAQAAAAAAAAABVJbnZhbGlkUm9vbVRyYW5zaXRpb24AAAAAAAARAAAAAAAAABRQcm9vZlNlc3Npb25NaXNtYXRjaAAAABIAAAAAAAAAEVByb29mVHVybk1pc21hdGNoAAAAAAAAEwAAAAAAAAASQ29tbWl0bWVudE1pc21hdGNoAAAAAAAUAAAAAAAAAA5WZXJpZmllck5vdFNldAAAAAAAFQAAAAAAAAAMSW52YWxpZFByb29mAAAAFgAAAAAAAAAKRDJNaXNtYXRjaAAAAAAAFwAAAAAAAAAORDJDaGFkTWlzbWF0Y2gAAAAAABgAAAAAAAAAEUNoYWRDb29yZE1pc21hdGNoAAAAAAAAGQAAAAAAAAAQQXNzYXNzaW5NdXN0TW92ZQAAABoAAAAAAAAAFVJ1bnRpbWVOb3RJbml0aWFsaXplZAAAAAAAABsAAAAAAAAAF1Nlc3Npb25LZXlOb3RBdXRob3JpemVkAAAAABwAAAAAAAAAEVNlc3Npb25LZXlFeHBpcmVkAAAAAAAAHQAAAAAAAAAaU2Vzc2lvbktleU1ldGhvZE5vdEFsbG93ZWQAAAAAAB4AAAAAAAAAHFNlc3Npb25LZXlXcml0ZUxpbWl0RXhjZWVkZWQAAAAfAAAAAAAAABZTZXNzaW9uS2V5Um9sZU1pc21hdGNoAAAAAAAg",
        "AAAAAQAAAAAAAAAAAAAABlRvd2VycwAAAAAACAAAAAAAAAADZV94AAAAAAQAAAAAAAAAA2VfeQAAAAAEAAAAAAAAAANuX3gAAAAABAAAAAAAAAADbl95AAAAAAQAAAAAAAAAA3NfeAAAAAAEAAAAAAAAAANzX3kAAAAABAAAAAAAAAADd194AAAAAAQAAAAAAAAAA3dfeQAAAAAE",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAHR2FtZUh1YgAAAAAAAAAAAAAAAAZUb3dlcnMAAAAAAAEAAAAAAAAAC1Nlc3Npb25Db3JlAAAAAAEAAAAEAAAAAQAAAAAAAAAOU2Vzc2lvblJ1bnRpbWUAAAAAAAEAAAAEAAAAAAAAAAAAAAAMUGluZ1ZlcmlmaWVyAAAAAAAAAAAAAAASVHVyblN0YXR1c1ZlcmlmaWVyAAAAAAAAAAAAAAAAAAxNb3ZlVmVyaWZpZXIAAAABAAAAAAAAAA9TZXNzaW9uS2V5U2NvcGUAAAAAAwAAAAQAAAATAAAABA==",
        "AAAAAQAAAAAAAAAAAAAAB1Nlc3Npb24AAAAAFwAAAAAAAAAFYWxwaGEAAAAAAAAEAAAAAAAAAAlhbHBoYV9tYXgAAAAAAAAEAAAAAAAAAAhhc3Nhc3NpbgAAABMAAAAAAAAAGGFzc2Fzc2luX21vdmVzX3RoaXNfdHVybgAAAAQAAAAAAAAAB2JhdHRlcnkAAAAABAAAAAAAAAALY2hhZF9oaWRkZW4AAAAAAQAAAAAAAAAQY2hhZF9oaWRlX3N0cmVhawAAAAQAAAAAAAAABmNoYWRfeAAAAAAABAAAAAAAAAAGY2hhZF95AAAAAAAEAAAAAAAAAApjb21taXRtZW50AAAAAAPoAAAD7gAAACAAAAAAAAAAAmQyAAAAAAPoAAAABAAAAAAAAAAHZDJfY2hhZAAAAAPoAAAABAAAAAAAAAAKZGlzcGF0Y2hlcgAAAAAAEwAAAAAAAAAFZW5kZWQAAAAAAAABAAAAAAAAAA1pbnNlY3VyZV9tb2RlAAAAAAAAAQAAAAAAAAAPbW92ZWRfdGhpc190dXJuAAAAAAEAAAAAAAAAEnBlbmRpbmdfcGluZ190b3dlcgAAAAAD6AAAAAQAAAAAAAAABXBoYXNlAAAAAAAH0AAAAAlUdXJuUGhhc2UAAAAAAAAAAAAACXBpbmdfY29zdAAAAAAAAAQAAAAAAAAAD3JlY2hhcmdlX2Ftb3VudAAAAAAEAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAABBzdHJvbmdfcmFkaXVzX3NxAAAABAAAAAAAAAAEdHVybgAAAAQ=",
        "AAAAAAAAAAAAAAAEaGlkZQAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAwAAAAAAAAAAAAAACVR1cm5QaGFzZQAAAAAAAAIAAAAAAAAACkRpc3BhdGNoZXIAAAAAAAAAAAAAAAAACEFzc2Fzc2luAAAAAQ==",
        "AAAAAgAAAAAAAAAAAAAAC0NoYWRDb21tYW5kAAAAAAQAAAAAAAAAAAAAAARTdGF5AAAAAAAAAAAAAAAESGlkZQAAAAEAAAAAAAAABkdvUm9vbQAAAAAAAQAAAAQAAAABAAAAAAAAAApXYWxrR2FyZGVuAAAAAAABAAAABA==",
        "AAAAAQAAAAAAAAAAAAAAC1Nlc3Npb25Db3JlAAAAAAoAAAAAAAAACWFscGhhX21heAAAAAAAAAQAAAAAAAAACGFzc2Fzc2luAAAAEwAAAAAAAAAKY29tbWl0bWVudAAAAAAD6AAAA+4AAAAgAAAAAAAAAApkaXNwYXRjaGVyAAAAAAATAAAAAAAAAAtpbml0X2NoYWRfeAAAAAAEAAAAAAAAAAtpbml0X2NoYWRfeQAAAAAEAAAAAAAAAA1pbnNlY3VyZV9tb2RlAAAAAAAAAQAAAAAAAAATcnVudGltZV9pbml0aWFsaXplZAAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAABBzdHJvbmdfcmFkaXVzX3NxAAAABA==",
        "AAAAAAAAAAAAAAAIZGlzcGF0Y2gAAAAEAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAApkaXNwYXRjaGVyAAAAAAATAAAAAAAAAAh0b3dlcl9pZAAAAAQAAAAAAAAAB2NvbW1hbmQAAAAH0AAAAAtDaGFkQ29tbWFuZAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAIcmVjaGFyZ2UAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAApkaXNwYXRjaGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAQAAAAAAAAAAAAAADlNlc3Npb25SdW50aW1lAAAAAAAMAAAAAAAAAAVhbHBoYQAAAAAAAAQAAAAAAAAAGGFzc2Fzc2luX21vdmVzX3RoaXNfdHVybgAAAAQAAAAAAAAAB2JhdHRlcnkAAAAABAAAAAAAAAALY2hhZF9oaWRkZW4AAAAAAQAAAAAAAAAQY2hhZF9oaWRlX3N0cmVhawAAAAQAAAAAAAAABmNoYWRfeAAAAAAABAAAAAAAAAAGY2hhZF95AAAAAAAEAAAAAAAAAAVlbmRlZAAAAAAAAAEAAAAAAAAAD21vdmVkX3RoaXNfdHVybgAAAAABAAAAAAAAABJwZW5kaW5nX3BpbmdfdG93ZXIAAAAAA+gAAAAEAAAAAAAAAAVwaGFzZQAAAAAAB9AAAAAJVHVyblBoYXNlAAAAAAAAAAAAAAR0dXJuAAAABA==",
        "AAAAAAAAAAAAAAAKZ2V0X3Rvd2VycwAAAAAAAAAAAAEAAAfQAAAABlRvd2VycwAA",
        "AAAAAAAAAAAAAAAKc2V0X3Rvd2VycwAAAAAAAQAAAAAAAAAGdG93ZXJzAAAAAAfQAAAABlRvd2VycwAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAKZGlzcGF0Y2hlcgAAAAAAEwAAAAAAAAAIYXNzYXNzaW4AAAATAAAAAAAAAAlhbHBoYV9tYXgAAAAAAAALAAAAAAAAABBzdHJvbmdfcmFkaXVzX3NxAAAACwAAAAA=",
        "AAAAAQAAAAAAAAAAAAAAD1Nlc3Npb25LZXlTY29wZQAAAAAIAAAAAAAAAAphbGxvd19tYXNrAAAAAAAEAAAAAAAAAAhkZWxlZ2F0ZQAAABMAAAAAAAAADmV4cGlyZXNfbGVkZ2VyAAAAAAAEAAAAAAAAAAptYXhfd3JpdGVzAAAAAAAEAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHJvbGUAAAfQAAAABFJvbGUAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAC3dyaXRlc191c2VkAAAAAAQ=",
        "AAAAAAAAAAAAAAALZ2V0X3Nlc3Npb24AAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAEAAAPpAAAH0AAAAAdTZXNzaW9uAAAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X2dhbWVfaHViAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMcmVxdWVzdF9waW5nAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAKZGlzcGF0Y2hlcgAAAAAAEwAAAAAAAAAIdG93ZXJfaWQAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANYXNzYXNzaW5fdGljawAAAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACGFzc2Fzc2luAAAAEwAAAAAAAAAHZDJfY2hhZAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANZ2V0X3ZlcmlmaWVycwAAAAAAAAAAAAABAAAD7QAAAAMAAAATAAAAEwAAABM=",
        "AAAAAAAAAAAAAAANc2V0X3ZlcmlmaWVycwAAAAAAAAMAAAAAAAAABnBpbmdfdgAAAAAAEwAAAAAAAAAGdHVybl92AAAAAAATAAAAAAAAAAZtb3ZlX3YAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAOc3RhcnRfZ2FtZV9leHQAAAAAAAcAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACmRpc3BhdGNoZXIAAAAAABMAAAAAAAAACGFzc2Fzc2luAAAAEwAAAAAAAAAGY2hhZF94AAAAAAAEAAAAAAAAAAZjaGFkX3kAAAAAAAQAAAAAAAAACWFscGhhX21heAAAAAAAAAQAAAAAAAAAEHN0cm9uZ19yYWRpdXNfc3EAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAPY29tbWl0X2xvY2F0aW9uAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACGFzc2Fzc2luAAAAEwAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAIxEaXNwYXRjaGVyIGNhbiBwZXJtYW5lbnRseSBsb2NrIGEgc2Vzc2lvbiBpbnRvIHNlY3VyZSBtb2RlLgpUaGlzIGlzIHNhZmUgYmVjYXVzZSBpdCBvbmx5IGFsbG93cyBkaXNhYmxpbmcgaW5zZWN1cmUgbW9kZSAobmV2ZXIgZW5hYmxpbmcgaXQpLgAAABBsb2NrX3NlY3VyZV9tb2RlAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAKZGlzcGF0Y2hlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAARc2V0X2luc2VjdXJlX21vZGUAAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAdlbmFibGVkAAAAAAEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARc3VibWl0X21vdmVfcHJvb2YAAAAAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhhc3Nhc3NpbgAAABMAAAAAAAAADm5ld19jb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAAAAAA1wdWJsaWNfaW5wdXRzAAAAAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAARc3VibWl0X3BpbmdfcHJvb2YAAAAAAAAGAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhhc3Nhc3NpbgAAABMAAAAAAAAACHRvd2VyX2lkAAAABAAAAAAAAAACZDIAAAAAAAQAAAAAAAAABXByb29mAAAAAAAADgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAPuAAAAIAAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAAAAAAAAAAASZGlzcGF0Y2hlcl9jb21tYW5kAAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAApkaXNwYXRjaGVyAAAAAAATAAAAAAAAAAdjb21tYW5kAAAAB9AAAAALQ2hhZENvbW1hbmQAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAScmV2b2tlX3Nlc3Npb25fa2V5AAAAAAADAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABHJvbGUAAAfQAAAABFJvbGUAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAVYXV0aG9yaXplX3Nlc3Npb25fa2V5AAAAAAAABwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAhkZWxlZ2F0ZQAAABMAAAAAAAAAC3R0bF9sZWRnZXJzAAAAAAQAAAAAAAAACm1heF93cml0ZXMAAAAAAAQAAAAAAAAAFWRpc3BhdGNoZXJfYWxsb3dfbWFzawAAAAAAAAQAAAAAAAAAE2Fzc2Fzc2luX2FsbG93X21hc2sAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAVZ2V0X3Nlc3Npb25fa2V5X3Njb3BlAAAAAAAAAwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAARyb2xlAAAH0AAAAARSb2xlAAAAAQAAA+gAAAfQAAAAD1Nlc3Npb25LZXlTY29wZQA=",
        "AAAAAAAAAAAAAAAYc3VibWl0X3R1cm5fc3RhdHVzX3Byb29mAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAIYXNzYXNzaW4AAAATAAAAAAAAAAdkMl9jaGFkAAAAAAQAAAAAAAAABXByb29mAAAAAAAADgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAPuAAAAIAAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAAAAAAAAAAAaaW5pdGlhbGl6ZV9zZXNzaW9uX3J1bnRpbWUAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAACmRpc3BhdGNoZXIAAAAAABMAAAABAAAD6QAAAAIAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    hide: this.txFromJSON<Result<void>>,
        dispatch: this.txFromJSON<Result<void>>,
        recharge: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<string>,
        get_towers: this.txFromJSON<Towers>,
        set_towers: this.txFromJSON<null>,
        start_game: this.txFromJSON<null>,
        get_session: this.txFromJSON<Result<Session>>,
        get_game_hub: this.txFromJSON<string>,
        request_ping: this.txFromJSON<Result<void>>,
        assassin_tick: this.txFromJSON<Result<void>>,
        get_verifiers: this.txFromJSON<readonly [string, string, string]>,
        set_verifiers: this.txFromJSON<null>,
        start_game_ext: this.txFromJSON<null>,
        commit_location: this.txFromJSON<Result<void>>,
        lock_secure_mode: this.txFromJSON<Result<void>>,
        set_insecure_mode: this.txFromJSON<Result<void>>,
        submit_move_proof: this.txFromJSON<Result<void>>,
        submit_ping_proof: this.txFromJSON<Result<u32>>,
        dispatcher_command: this.txFromJSON<Result<void>>,
        revoke_session_key: this.txFromJSON<Result<void>>,
        authorize_session_key: this.txFromJSON<Result<void>>,
        get_session_key_scope: this.txFromJSON<Option<SessionKeyScope>>,
        submit_turn_status_proof: this.txFromJSON<Result<u32>>,
        initialize_session_runtime: this.txFromJSON<Result<void>>
  }
}