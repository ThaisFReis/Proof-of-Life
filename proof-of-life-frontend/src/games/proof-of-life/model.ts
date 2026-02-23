export type GameMode = 'single' | 'two-player';
export type TurnPhase = 'dispatcher' | 'assassin';
export type TowerId = 'N' | 'S' | 'E' | 'W';
export type SessionOutcome = 'win_extraction' | 'loss_caught' | 'loss_blackout' | 'loss_panic';

export interface SessionState {
  sessionId: number;
  mode: GameMode;
  dispatcher: string;
  assassin: string;
  commitmentSet: boolean;
  battery: number; // 0..100
  pingCost: number; // 20
  rechargeAmount: number; // 10
  turn: number;
  extractionTurn?: number;
  phase: TurnPhase;
  // Turn order (prototype): action (PING/RECHARGE) -> command (Chad) -> resolve.
  turn_step: 'action' | 'command';
  ended: boolean;
  outcome?: SessionOutcome;
  log: string[];

  // Phase 5 simulation only; the on-chain equivalent is enforced via contract state.
  moved_this_turn?: boolean;
  alpha?: number;
  alpha_max?: number;

  // Chad is simulated client-side for now.
  chad_x?: number;
  chad_y?: number;
  pending_chad_cmd?: ChadCommand;
  chad_hidden?: boolean;
  chad_hide_streak?: number; // consecutive successful HIDE turns (max 2)
  pending_ping_tower?: number | null;
  insecure_mode?: boolean;
}

export type ChadCommand =
  | 'STAY'
  | 'HIDE'
  | 'WALK_N'
  | 'WALK_S'
  | 'WALK_W'
  | 'WALK_E'
  | 'GO_GARDEN'
  | 'GO_HALLWAY'
  | 'GO_LIVING'
  | 'GO_STUDY'
  | 'GO_LIBRARY'
  | 'GO_DINING'
  | 'GO_KITCHEN'
  | 'GO_GRAND_HALL';

export type { EncryptedSecret } from './utils/encryption';

// Lobby / two-player matchmaking types

/** Serialized as "POL1-<base64>" — shared dispatcher → assassin */
export interface LobbyCode {
  v: 1;
  sid: number;     // session ID
  d: string;       // dispatcher Stellar address
  net: string;     // network passphrase (short: "testnet" | "mainnet" | full)
  cid: string;     // contract ID
}

/** Serialized as "POL1R-<base64>" — shared assassin → dispatcher */
export interface LobbyResponse {
  v: 1;
  sid: number;     // must match LobbyCode.sid
  a: string;       // assassin Stellar address
}

/** Phase within the lobby flow */
export type LobbyPhase =
  | 'choose'       // choose create / join
  | 'create'       // dispatcher: show lobby code, wait for response
  | 'join'         // assassin: paste lobby code, accept
  | 'waiting';     // assassin: waiting for dispatcher to start game
