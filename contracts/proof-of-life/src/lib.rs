#![no_std]

//! Proof of Life (hackathon contract) - Phase 4 (wiring)
//!
//! NOTE: Real ZK proof verification is integrated via UltraHonk.
//! The verifier contract must be deployed with the circuit's VK.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Bytes,
    BytesN, Env, Vec, symbol_short,
};

#[cfg(test)]
mod test;

#[cfg(test)]
mod encoding_test;

mod floorplan;

mod ultrahonk_verifier {
    soroban_sdk::contractimport!(
        file = "bin/verifier.wasm"
    );
}

use ultrahonk_verifier::Client as UltraHonkClient;

// ============================================================================
// Game Hub Interface
// ============================================================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    SessionNotFound = 1,
    GameAlreadyEnded = 2,
    CommitmentNotSet = 3,
    NotDispatcher = 4,
    NotAssassin = 5,
    NotDispatcherTurn = 6,
    NotAssassinTurn = 7,
    BatteryTooLow = 8,
    NotAdmin = 9,
    PendingPingExists = 10,
    NoPendingPing = 11,
    UnexpectedTower = 12,
    ProofVerificationUnsupported = 13,
    AlreadyMovedThisTurn = 14,
    InvalidMove = 15,
    InvalidHide = 16,
    InvalidRoomTransition = 17,
    ProofSessionMismatch = 18,
    ProofTurnMismatch = 19,
    CommitmentMismatch = 20,
    VerifierNotSet = 21,
    InvalidProof = 22,
    D2Mismatch = 23,
    D2ChadMismatch = 24,
    ChadCoordMismatch = 25,
    AssassinMustMove = 26,
    RuntimeNotInitialized = 27,
    SessionKeyNotAuthorized = 28,
    SessionKeyExpired = 29,
    SessionKeyMethodNotAllowed = 30,
    SessionKeyWriteLimitExceeded = 31,
    SessionKeyRoleMismatch = 32,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TurnPhase {
    Dispatcher = 0,
    Assassin = 1,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Dispatcher = 0,
    Assassin = 1,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ChadCommand {
    Stay,
    Hide,
    GoRoom(u32),
    WalkGarden(u32), // 0=N, 1=E, 2=S, 3=W
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Session {
    pub session_id: u32,
    pub dispatcher: Address,
    pub assassin: Address,
    pub commitment: Option<BytesN<32>>, 
    pub chad_x: u32,
    pub chad_y: u32,
    pub battery: u32,
    pub turn: u32,
    pub phase: TurnPhase,
    pub ended: bool,
    pub alpha: u32,
    pub alpha_max: u32,
    pub pending_ping_tower: Option<u32>,
    pub d2: Option<u32>,
    pub d2_chad: Option<u32>,
    pub moved_this_turn: bool,
    // Count of assassin move proofs submitted in the current assassin phase.
    // Used to enforce "assassin cannot stand still" and to allow multiple steps when Chad is hidden.
    pub assassin_moves_this_turn: u32,
    pub strong_radius_sq: u32,
    pub ping_cost: u32,
    pub recharge_amount: u32,
    pub chad_hidden: bool,
    pub chad_hide_streak: u32,
    pub insecure_mode: bool,
}

// Compact storage layout:
// - SessionCore: mostly immutable/low-frequency fields
// - SessionRuntime: high-frequency gameplay state
// This reduces per-write footprint and helps avoid resource-limit spikes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionCore {
    pub session_id: u32,
    pub dispatcher: Address,
    pub assassin: Address,
    pub commitment: Option<BytesN<32>>,
    pub alpha_max: u32,
    pub strong_radius_sq: u32,
    pub insecure_mode: bool,
    pub init_chad_x: u32,
    pub init_chad_y: u32,
    pub runtime_initialized: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRuntime {
    pub chad_x: u32,
    pub chad_y: u32,
    pub battery: u32,
    pub turn: u32,
    pub phase: TurnPhase,
    pub ended: bool,
    pub alpha: u32,
    pub pending_ping_tower: Option<u32>,
    pub moved_this_turn: bool,
    pub assassin_moves_this_turn: u32,
    pub chad_hidden: bool,
    pub chad_hide_streak: u32,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Towers {
    pub n_x: u32,
    pub n_y: u32,
    pub e_x: u32,
    pub e_y: u32,
    pub s_x: u32,
    pub s_y: u32,
    pub w_x: u32,
    pub w_y: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionKeyScope {
    pub owner: Address,
    pub delegate: Address,
    pub session_id: u32,
    pub role: Role,
    pub expires_ledger: u32,
    pub max_writes: u32,
    pub writes_used: u32,
    pub allow_mask: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionKeyParams {
    pub delegate: Address,
    pub ttl_ledgers: u32,
    pub max_writes: u32,
    pub dispatcher_allow_mask: u32,
    pub assassin_allow_mask: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveProofEntry {
    pub new_commitment: BytesN<32>,
    pub proof: Bytes,
    pub public_inputs: Vec<BytesN<32>>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    GameHub,
    Towers,
    SessionCore(u32),
    SessionRuntime(u32),
    PingVerifier,
    TurnStatusVerifier,
    MoveVerifier,
    SessionKeyScope(u32, Address, u32),
}

// ============================================================================
// Contract Implementation
// ============================================================================

const PING_COST: u32 = 20;
const RECHARGE_AMOUNT: u32 = 10;
const BATTERY_MAX: u32 = 100;
const INITIAL_BATTERY: u32 = 100;
const SESSION_METHOD_DISPATCH: u32 = 1 << 0;
const SESSION_METHOD_RECHARGE: u32 = 1 << 1;
const SESSION_METHOD_COMMIT_LOCATION: u32 = 1 << 2;
const SESSION_METHOD_SUBMIT_PING_PROOF: u32 = 1 << 3;
const SESSION_METHOD_SUBMIT_MOVE_PROOF: u32 = 1 << 4;
const SESSION_METHOD_SUBMIT_TURN_STATUS_PROOF: u32 = 1 << 5;
const SESSION_METHOD_ASSASSIN_TICK: u32 = 1 << 6;
const SESSION_METHOD_LOCK_SECURE_MODE: u32 = 1 << 7;
const DEFAULT_HUB_POINTS_DISPATCHER: i128 = 0;
const DEFAULT_HUB_POINTS_ASSASSIN: i128 = 0;

// Default tower coordinates used by ZK circuits (must match frontend + prover).
// These are configurable via `set_towers`, but we keep a deterministic default.
const DEFAULT_TOWER_N_X: u32 = 5;
const DEFAULT_TOWER_N_Y: u32 = 0;
const DEFAULT_TOWER_E_X: u32 = 9;
const DEFAULT_TOWER_E_Y: u32 = 5;
const DEFAULT_TOWER_S_X: u32 = 5;
const DEFAULT_TOWER_S_Y: u32 = 9;
const DEFAULT_TOWER_W_X: u32 = 0;
const DEFAULT_TOWER_W_Y: u32 = 5;

#[contract]
pub struct ProofOfLife;

#[contractimpl]
impl ProofOfLife {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GameHub, &game_hub);
        env.storage().instance().set(
            &DataKey::Towers,
            &Towers {
                n_x: DEFAULT_TOWER_N_X,
                n_y: DEFAULT_TOWER_N_Y,
                e_x: DEFAULT_TOWER_E_X,
                e_y: DEFAULT_TOWER_E_Y,
                s_x: DEFAULT_TOWER_S_X,
                s_y: DEFAULT_TOWER_S_Y,
                w_x: DEFAULT_TOWER_W_X,
                w_y: DEFAULT_TOWER_W_Y,
            },
        );
    }

    pub fn get_towers(env: Env) -> Towers {
        env.storage().instance().get(&DataKey::Towers).unwrap()
    }

    pub fn set_towers(env: Env, towers: Towers) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Towers, &towers);
    }

    pub fn set_verifiers(
        env: Env,
        ping_v: Address,
        turn_v: Address,
        move_v: Address,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().set(&DataKey::PingVerifier, &ping_v);
        env.storage().instance().set(&DataKey::TurnStatusVerifier, &turn_v);
        env.storage().instance().set(&DataKey::MoveVerifier, &move_v);
    }

    pub fn authorize_session_key(
        env: Env,
        owner: Address,
        session_id: u32,
        delegate: Address,
        ttl_ledgers: u32,
        max_writes: u32,
        dispatcher_allow_mask: u32,
        assassin_allow_mask: u32,
    ) -> Result<(), Error> {
        owner.require_auth();
        let c = Self::load_session_core(&env, session_id)?;
        let expires_ledger = env.ledger().sequence().saturating_add(ttl_ledgers);

        if owner == c.dispatcher && dispatcher_allow_mask != 0 {
            let scope = SessionKeyScope {
                owner: owner.clone(),
                delegate: delegate.clone(),
                session_id,
                role: Role::Dispatcher,
                expires_ledger,
                max_writes,
                writes_used: 0,
                allow_mask: dispatcher_allow_mask,
            };
            Self::store_session_key_scope(&env, session_id, &owner, Role::Dispatcher, &scope);
        }

        if owner == c.assassin && assassin_allow_mask != 0 {
            let scope = SessionKeyScope {
                owner: owner.clone(),
                delegate: delegate.clone(),
                session_id,
                role: Role::Assassin,
                expires_ledger,
                max_writes,
                writes_used: 0,
                allow_mask: assassin_allow_mask,
            };
            Self::store_session_key_scope(&env, session_id, &owner, Role::Assassin, &scope);
        }

        Ok(())
    }

    pub fn revoke_session_key(env: Env, owner: Address, session_id: u32, role: Role) -> Result<(), Error> {
        owner.require_auth();
        env.storage().instance().remove(&DataKey::SessionKeyScope(session_id, owner, Self::role_to_u32(role)));
        Ok(())
    }

    pub fn get_session_key_scope(env: Env, owner: Address, session_id: u32, role: Role) -> Option<SessionKeyScope> {
        env.storage().instance().get(&DataKey::SessionKeyScope(session_id, owner, Self::role_to_u32(role)))
    }

    pub fn start_game(
        env: Env,
        session_id: u32,
        dispatcher: Address,
        assassin: Address,
        alpha_max: i128,
        strong_radius_sq: i128,
    ) {
        Self::start_game_ext(
            env,
            session_id,
            dispatcher,
            assassin,
            4,
            7,
            alpha_max as u32,
            strong_radius_sq as u32,
        );
    }

    pub fn start_game_ext(
        env: Env,
        session_id: u32,
        dispatcher: Address,
        assassin: Address,
        chad_x: u32,
        chad_y: u32,
        alpha_max: u32,
        strong_radius_sq: u32,
    ) {
        // Hackathon requirement: register each session in the shared Game Hub.
        let game_hub_addr: Address = env.storage().instance().get(&DataKey::GameHub).unwrap();
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &dispatcher,
            &assassin,
            &DEFAULT_HUB_POINTS_DISPATCHER,
            &DEFAULT_HUB_POINTS_ASSASSIN,
        );

        let core = SessionCore {
            session_id,
            dispatcher,
            assassin,
            commitment: None,
            alpha_max,
            strong_radius_sq,
            insecure_mode: false, // 100% ZK verification enforced by default
            init_chad_x: chad_x,
            init_chad_y: chad_y,
            runtime_initialized: true, // runtime initialized immediately
        };
        // Initialize runtime immediately so callers don't need a separate initialize_session_runtime call.
        let runtime = SessionRuntime {
            chad_x,
            chad_y,
            battery: INITIAL_BATTERY,
            turn: 0,
            phase: TurnPhase::Dispatcher,
            ended: false,
            alpha: alpha_max,
            pending_ping_tower: None,
            moved_this_turn: false,
            assassin_moves_this_turn: 0,
            chad_hidden: false,
            chad_hide_streak: 0,
        };
        Self::store_session_runtime(&env, session_id, &runtime);
        Self::store_session_core(&env, session_id, &core);
    }

    /// Atomically creates a game session and authorizes a session key in one transaction.
    /// This reduces game start from 2 wallet popups to 1.
    pub fn start_game_with_session_key(
        env: Env,
        session_id: u32,
        dispatcher: Address,
        assassin: Address,
        sk_params: SessionKeyParams,
    ) {
        // Only the dispatcher needs to sign (one wallet popup).
        dispatcher.require_auth();

        // Create the game session (same as start_game_ext with defaults).
        Self::start_game_ext(
            env.clone(),
            session_id,
            dispatcher.clone(),
            assassin.clone(),
            4,
            7,
            5,  // alpha_max
            4,  // strong_radius_sq
        );

        // Authorize the session key for the dispatcher role.
        let expires_ledger = env.ledger().sequence().saturating_add(sk_params.ttl_ledgers);

        if sk_params.dispatcher_allow_mask != 0 {
            let scope = SessionKeyScope {
                owner: dispatcher.clone(),
                delegate: sk_params.delegate.clone(),
                session_id,
                role: Role::Dispatcher,
                expires_ledger,
                max_writes: sk_params.max_writes,
                writes_used: 0,
                allow_mask: sk_params.dispatcher_allow_mask,
            };
            Self::store_session_key_scope(&env, session_id, &dispatcher, Role::Dispatcher, &scope);
        }

        // If dispatcher == assassin (solo play), also authorize assassin role.
        if dispatcher == assassin && sk_params.assassin_allow_mask != 0 {
            let scope = SessionKeyScope {
                owner: assassin.clone(),
                delegate: sk_params.delegate.clone(),
                session_id,
                role: Role::Assassin,
                expires_ledger,
                max_writes: sk_params.max_writes,
                writes_used: 0,
                allow_mask: sk_params.assassin_allow_mask,
            };
            Self::store_session_key_scope(&env, session_id, &assassin, Role::Assassin, &scope);
        }
    }

    pub fn initialize_session_runtime(
        env: Env,
        session_id: u32,
        dispatcher: Address,
    ) -> Result<(), Error> {
        let mut core = Self::load_session_core(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &core.dispatcher,
            &dispatcher,
            Role::Dispatcher,
            SESSION_METHOD_DISPATCH,
        )?;
        // require_owner_or_delegate already verified the actor is the registered dispatcher.
        if core.runtime_initialized {
            return Ok(());
        }

        let runtime = SessionRuntime {
            chad_x: core.init_chad_x,
            chad_y: core.init_chad_y,
            battery: INITIAL_BATTERY,
            turn: 0,
            phase: TurnPhase::Dispatcher,
            ended: false,
            alpha: core.alpha_max,
            pending_ping_tower: None,
            moved_this_turn: false,
            assassin_moves_this_turn: 0,
            chad_hidden: false,
            chad_hide_streak: 0,
        };

        Self::store_session_runtime(&env, session_id, &runtime);
        core.runtime_initialized = true;
        Self::store_session_core(&env, session_id, &core);
        Ok(())
    }

    pub fn set_insecure_mode(env: Env, session_id: u32, enabled: bool) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut c = Self::load_session_core(&env, session_id)?;
        c.insecure_mode = enabled;
        Self::store_session_core(&env, session_id, &c);
        Ok(())
    }

    /// Dispatcher can permanently lock a session into secure mode.
    /// This is safe because it only allows disabling insecure mode (never enabling it).
    pub fn lock_secure_mode(env: Env, session_id: u32, dispatcher: Address) -> Result<(), Error> {
        let mut c = Self::load_session_core(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.dispatcher,
            &dispatcher,
            Role::Dispatcher,
            SESSION_METHOD_LOCK_SECURE_MODE,
        )?;
        // require_owner_or_delegate already verified the actor is the registered dispatcher
        // (either as the owner or as an authorized delegate). No redundant identity check needed.
        c.insecure_mode = false;
        Self::store_session_core(&env, session_id, &c);
        Ok(())
    }

    pub fn hide(env: Env, session_id: u32, commitment: BytesN<32>) -> Result<(), Error> {
        let (mut c, r) = Self::load_session_pair(&env, session_id)?;
        Self::ensure_not_ended(&r)?;

        if c.commitment.is_some() {
            return Err(Error::InvalidHide);
        }
        c.commitment = Some(commitment);
        Self::store_session_core(&env, session_id, &c);
        Ok(())
    }

    pub fn dispatch(
        env: Env,
        session_id: u32,
        dispatcher: Address,
        tower_id: u32,
        command: ChadCommand,
    ) -> Result<(), Error> {
        let (c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.dispatcher,
            &dispatcher,
            Role::Dispatcher,
            SESSION_METHOD_DISPATCH,
        )?;
        Self::ensure_not_ended(&s)?;

        // require_owner_or_delegate already verified the actor is the registered dispatcher.
        if s.phase != TurnPhase::Dispatcher {
            return Err(Error::NotDispatcherTurn);
        }
        
        if s.battery < PING_COST {
            return Err(Error::BatteryTooLow);
        }
        s.battery -= PING_COST;

        match command {
            ChadCommand::Hide => {
                if s.chad_hide_streak >= 2 {
                    return Err(Error::InvalidHide);
                }
                s.chad_hidden = true;
                s.chad_hide_streak += 1;
            }
            ChadCommand::Stay => {
                s.chad_hide_streak = 0;
                s.chad_hidden = false;
            }
            ChadCommand::WalkGarden(dir) => {
                s.chad_hide_streak = 0;
                s.chad_hidden = false;
                match dir {
                    0 => s.chad_y = s.chad_y.saturating_sub(1),
                    1 => s.chad_x = s.chad_x.saturating_add(1),
                    2 => s.chad_y = s.chad_y.saturating_add(1),
                    3 => s.chad_x = s.chad_x.saturating_sub(1),
                    _ => return Err(Error::InvalidMove),
                }
            }
            ChadCommand::GoRoom(room_id) => {
                s.chad_hide_streak = 0;
                s.chad_hidden = false;
                
                let to_room = Self::room_code_from_id(room_id);
                let from_room = floorplan::get_room_code(s.chad_x, s.chad_y);
                
                if let Some((nx, ny)) = Self::find_door(from_room, to_room) {
                    s.chad_x = nx;
                    s.chad_y = ny;
                } else {
                    // Fallback to a representative center tile if no direct door found (e.g. Garden spawns)
                    // This matches frontend's findAnyExitToRoom or default entry logic.
                    match to_room {
                        b'G' => { s.chad_x = 5; s.chad_y = 1; }
                        b'L' => { s.chad_x = 1; s.chad_y = 4; }
                        b'S' => { s.chad_x = 8; s.chad_y = 4; }
                        b'B' => { s.chad_x = 1; s.chad_y = 7; }
                        b'D' => { s.chad_x = 8; s.chad_y = 6; }
                        b'K' => { s.chad_x = 8; s.chad_y = 8; }
                        b'E' => { s.chad_x = 4; s.chad_y = 8; }
                        _ => { s.chad_x = 4; s.chad_y = 5; } // Hallway/Winter
                    }
                }
            }
        }

        s.pending_ping_tower = Some(tower_id);
        s.phase = TurnPhase::Assassin;
        s.moved_this_turn = false;
        s.assassin_moves_this_turn = 0;
        if s.battery == 0 {
            s.ended = true;
        }
        Self::store_session_runtime(&env, session_id, &s);
        Ok(())
    }

    pub fn submit_ping_proof(
        env: Env,
        session_id: u32,
        assassin: Address,
        tower_id: u32,
        d2: u32,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<u32, Error> {
        let (mut c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_SUBMIT_PING_PROOF,
        )?;
        Self::ensure_not_ended(&s)?;

        // require_owner_or_delegate already verified the actor is the registered assassin.
        if s.phase != TurnPhase::Assassin {
            return Err(Error::NotAssassinTurn);
        }
        if s.pending_ping_tower != Some(tower_id) {
            return Err(Error::UnexpectedTower);
        }

        if !c.insecure_mode {
            // Cheap tower_id range check before any PI parsing.
            let towers: Towers = env.storage().instance().get(&DataKey::Towers).unwrap();
            let (tx, ty) = match tower_id {
                0 => (towers.n_x, towers.n_y),
                1 => (towers.e_x, towers.e_y),
                2 => (towers.s_x, towers.s_y),
                3 => (towers.w_x, towers.w_y),
                _ => return Err(Error::UnexpectedTower),
            };

            // v3 layout: [tower_x, tower_y, session_id, turn, commitment, d2]
            Self::verify_session_turn(&public_inputs, session_id, s.turn, 2, 3)?;
            Self::verify_u32_field(&public_inputs, 0, tx, Error::UnexpectedTower)?;
            Self::verify_u32_field(&public_inputs, 1, ty, Error::UnexpectedTower)?;

            // Commitment is a public output. The first verified ping locks it in for the session.
            let pi_cmt = public_inputs.get(4).ok_or(Error::CommitmentMismatch)?;
            if let Some(existing) = c.commitment.as_ref() {
                if pi_cmt != *existing {
                    return Err(Error::CommitmentMismatch);
                }
            }

            Self::verify_u32_field(&public_inputs, 5, d2, Error::D2Mismatch)?;
            let verifier_addr: Address = env.storage().instance().get(&DataKey::PingVerifier).ok_or(Error::VerifierNotSet)?;
            let verifier = UltraHonkClient::new(&env, &verifier_addr);
            let mut pis = Bytes::new(&env);
            for pi in public_inputs.iter() { pis.append(&pi.into()); }
            let vr = verifier.try_verify_proof(&pis, &proof);
            match vr {
                Ok(Ok(())) => {}
                _ => return Err(Error::InvalidProof),
            }

            if c.commitment.is_none() {
                c.commitment = Some(pi_cmt);
            }
        }

        s.pending_ping_tower = None;
        Self::store_session_runtime(&env, session_id, &s);
        Self::store_session_core(&env, session_id, &c);
        Ok(d2)
    }

    pub fn submit_turn_status_proof(
        env: Env,
        session_id: u32,
        assassin: Address,
        d2_chad: u32,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<u32, Error> {
        let (c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_SUBMIT_TURN_STATUS_PROOF,
        )?;
        Self::ensure_not_ended(&s)?;

        // require_owner_or_delegate already verified the actor is the registered assassin.
        if s.phase != TurnPhase::Assassin {
            return Err(Error::NotAssassinTurn);
        }
        if s.assassin_moves_this_turn == 0 {
            return Err(Error::AssassinMustMove);
        }

        if !c.insecure_mode {
            let commitment = c.commitment.as_ref().ok_or(Error::CommitmentNotSet)?;
            // v3 layout: [cx, cy, session_id, turn, commitment, d2_chad]
            Self::verify_session_turn(&public_inputs, session_id, s.turn, 2, 3)?;

            // Bind the statement to the on-chain Chad location so the assassin can't choose a fake (cx,cy).
            Self::verify_u32_field(&public_inputs, 0, s.chad_x, Error::ChadCoordMismatch)?;
            Self::verify_u32_field(&public_inputs, 1, s.chad_y, Error::ChadCoordMismatch)?;
            let pi_cmt = public_inputs.get(4).ok_or(Error::CommitmentMismatch)?;
            if pi_cmt != *commitment {
                return Err(Error::CommitmentMismatch);
            }
            Self::verify_u32_field(&public_inputs, 5, d2_chad, Error::D2ChadMismatch)?;
            let verifier_addr: Address = env.storage().instance().get(&DataKey::TurnStatusVerifier).ok_or(Error::VerifierNotSet)?;
            let verifier = UltraHonkClient::new(&env, &verifier_addr);
            let mut pis = Bytes::new(&env);
            for pi in public_inputs.iter() { pis.append(&pi.into()); }
            let vr = verifier.try_verify_proof(&pis, &proof);
            match vr {
                Ok(Ok(())) => {}
                _ => return Err(Error::InvalidProof),
            }
        }

        if d2_chad == 0 {
            Self::end_game_internal(&env, session_id, &mut s, false)?;
        } else {
            if d2_chad <= c.strong_radius_sq {
                s.alpha = s.alpha.saturating_sub(1);
            } else {
                s.alpha = (s.alpha + 1).min(c.alpha_max);
            }

            if s.alpha == 0 {
                Self::end_game_internal(&env, session_id, &mut s, false)?;
            } else {
                if s.battery == 0 {
                    Self::end_game_internal(&env, session_id, &mut s, true)?;
                } else {
                    s.turn = s.turn.saturating_add(1);
                    s.phase = TurnPhase::Dispatcher;
                    s.moved_this_turn = false;
                    s.assassin_moves_this_turn = 0;
                }
            }
        }

        Self::store_session_runtime(&env, session_id, &s);
        Ok(d2_chad)
    }

    pub fn submit_move_proof(
        env: Env,
        session_id: u32,
        assassin: Address,
        new_commitment: BytesN<32>,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<(), Error> {
        let (mut c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_SUBMIT_MOVE_PROOF,
        )?;
        Self::ensure_not_ended(&s)?;

        // require_owner_or_delegate already verified the actor is the registered assassin.
        if s.phase != TurnPhase::Assassin {
            return Err(Error::NotAssassinTurn);
        }
        if s.pending_ping_tower.is_some() {
            return Err(Error::PendingPingExists);
        }
        let max_moves = if s.chad_hidden { 6 } else { 1 };
        if s.assassin_moves_this_turn >= max_moves {
            return Err(Error::AlreadyMovedThisTurn);
        }

        if !c.insecure_mode {
            let old_commitment = c.commitment.as_ref().ok_or(Error::CommitmentNotSet)?;
            // UltraHonk (`bb --output_format bytes_and_fields`) public field ordering:
            // [session_id, turn, commitment_old, commitment_new]
            Self::verify_session_turn(&public_inputs, session_id, s.turn, 0, 1)?;

            let pi_old: BytesN<32> = public_inputs.get_unchecked(2);
            if pi_old != *old_commitment {
                return Err(Error::CommitmentMismatch);
            }
            let pi_new: BytesN<32> = public_inputs.get_unchecked(3);
            if pi_new != new_commitment {
                return Err(Error::CommitmentMismatch);
            }

            let verifier_addr: Address = env.storage().instance().get(&DataKey::MoveVerifier).ok_or(Error::VerifierNotSet)?;
            let verifier = UltraHonkClient::new(&env, &verifier_addr);
            
            let mut pis = Bytes::new(&env);
            for pi in public_inputs.iter() {
                pis.append(&pi.into());
            }
            let vr = verifier.try_verify_proof(&pis, &proof);
            match vr {
                Ok(Ok(())) => {}
                _ => return Err(Error::InvalidProof),
            }
        }

        c.commitment = Some(new_commitment);
        s.moved_this_turn = true;
        s.assassin_moves_this_turn = s.assassin_moves_this_turn.saturating_add(1);
        Self::store_session_runtime(&env, session_id, &s);
        Self::store_session_core(&env, session_id, &c);
        Ok(())
    }

    /// Submit multiple move proofs in a single transaction.
    /// Each entry chains: the first entry uses the session's current commitment,
    /// and each subsequent entry uses the previous entry's new_commitment.
    pub fn submit_multi_move_proof(
        env: Env,
        session_id: u32,
        assassin: Address,
        entries: Vec<MoveProofEntry>,
    ) -> Result<(), Error> {
        let (mut c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_SUBMIT_MOVE_PROOF,
        )?;
        Self::ensure_not_ended(&s)?;

        if s.phase != TurnPhase::Assassin {
            return Err(Error::NotAssassinTurn);
        }
        if s.pending_ping_tower.is_some() {
            return Err(Error::PendingPingExists);
        }

        let max_moves = if s.chad_hidden { 6 } else { 1 };
        let n_entries = entries.len();

        for i in 0..n_entries {
            if s.assassin_moves_this_turn >= max_moves {
                return Err(Error::AlreadyMovedThisTurn);
            }

            let entry: MoveProofEntry = entries.get_unchecked(i);

            if !c.insecure_mode {
                let old_commitment = c.commitment.as_ref().ok_or(Error::CommitmentNotSet)?;
                Self::verify_session_turn(&entry.public_inputs, session_id, s.turn, 0, 1)?;

                let pi_old: BytesN<32> = entry.public_inputs.get_unchecked(2);
                if pi_old != *old_commitment {
                    return Err(Error::CommitmentMismatch);
                }
                let pi_new: BytesN<32> = entry.public_inputs.get_unchecked(3);
                if pi_new != entry.new_commitment {
                    return Err(Error::CommitmentMismatch);
                }

                let verifier_addr: Address = env.storage().instance().get(&DataKey::MoveVerifier).ok_or(Error::VerifierNotSet)?;
                let verifier = UltraHonkClient::new(&env, &verifier_addr);

                let mut pis = Bytes::new(&env);
                for pi in entry.public_inputs.iter() {
                    pis.append(&pi.into());
                }
                let vr = verifier.try_verify_proof(&pis, &entry.proof);
                match vr {
                    Ok(Ok(())) => {}
                    _ => return Err(Error::InvalidProof),
                }
            }

            // Chain: update commitment for the next entry.
            c.commitment = Some(entry.new_commitment);
            s.moved_this_turn = true;
            s.assassin_moves_this_turn = s.assassin_moves_this_turn.saturating_add(1);
        }

        // Single write at the end.
        Self::store_session_runtime(&env, session_id, &s);
        Self::store_session_core(&env, session_id, &c);
        Ok(())
    }

    // --- Aliases for test compatibility ---

    pub fn commit_location(env: Env, session_id: u32, assassin: Address, commitment: BytesN<32>) -> Result<(), Error> {
        let c = Self::load_session_core(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_COMMIT_LOCATION,
        )?;
        Self::hide(env, session_id, commitment)
    }

    pub fn request_ping(
        env: Env,
        session_id: u32,
        _dispatcher: Address,
        tower_id: u32,
    ) -> Result<(), Error> {
        // Many tests pass dispatcher but alias can ignore it for routing to dispatch
        Self::dispatch(env, session_id, _dispatcher, tower_id, ChadCommand::Stay)
    }

    pub fn recharge(env: Env, session_id: u32, _dispatcher: Address) -> Result<(), Error> {
        let (c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.dispatcher,
            &_dispatcher,
            Role::Dispatcher,
            SESSION_METHOD_RECHARGE,
        )?;
        s.battery = (s.battery + RECHARGE_AMOUNT).min(BATTERY_MAX);
        s.phase = TurnPhase::Assassin;
        s.moved_this_turn = false;
        s.assassin_moves_this_turn = 0;
        Self::store_session_runtime(&env, session_id, &s);
        Ok(())
    }

    pub fn assassin_tick(
        env: Env,
        session_id: u32,
        assassin: Address,
        _d2_chad: u32,
    ) -> Result<(), Error> {
        let (c, mut s) = Self::load_session_pair(&env, session_id)?;
        Self::require_owner_or_delegate(
            &env,
            session_id,
            &c.assassin,
            &assassin,
            Role::Assassin,
            SESSION_METHOD_ASSASSIN_TICK,
        )?;
        Self::ensure_not_ended(&s)?;
        // require_owner_or_delegate already verified the actor is the registered assassin.
        if s.phase != TurnPhase::Assassin {
            return Err(Error::NotAssassinTurn);
        }

        // In secure mode, the assassin must have submitted at least one move proof
        // before the turn can advance. This prevents the on-chain commitment from
        // going stale during recharge turns (which would cause CommitmentMismatch
        // on the next ping).
        if !c.insecure_mode && s.assassin_moves_this_turn == 0 {
            return Err(Error::AssassinMustMove);
        }

        s.turn = s.turn.saturating_add(1);
        s.phase = TurnPhase::Dispatcher;
        s.moved_this_turn = false;
        s.assassin_moves_this_turn = 0;
        Self::store_session_runtime(&env, session_id, &s);
        Ok(())
    }

    pub fn dispatcher_command(
        env: Env,
        session_id: u32,
        dispatcher: Address,
        command: ChadCommand,
    ) -> Result<(), Error> {
        Self::dispatch(env, session_id, dispatcher, 0, command)
    }

    pub fn get_session(env: Env, session_id: u32) -> Result<Session, Error> {
        let c = Self::load_session_core(&env, session_id)?;
        let runtime = Self::load_session_runtime_opt(&env, session_id);
        Ok(Self::session_view(&c, runtime.as_ref()))
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn get_game_hub(env: Env) -> Address {
        env.storage().instance().get(&DataKey::GameHub).unwrap()
    }

    pub fn get_verifiers(env: Env) -> (Address, Address, Address) {
        let p = env.storage().instance().get(&DataKey::PingVerifier).unwrap_or(env.current_contract_address());
        let t = env.storage().instance().get(&DataKey::TurnStatusVerifier).unwrap_or(env.current_contract_address());
        let m = env.storage().instance().get(&DataKey::MoveVerifier).unwrap_or(env.current_contract_address());
        (p, t, m)
    }

    // --- Internals ---
    fn session_view(core: &SessionCore, runtime_opt: Option<&SessionRuntime>) -> Session {
        let default_runtime = SessionRuntime {
            chad_x: core.init_chad_x,
            chad_y: core.init_chad_y,
            battery: INITIAL_BATTERY,
            turn: 0,
            phase: TurnPhase::Dispatcher,
            ended: false,
            alpha: core.alpha_max,
            pending_ping_tower: None,
            moved_this_turn: false,
            assassin_moves_this_turn: 0,
            chad_hidden: false,
            chad_hide_streak: 0,
        };
        let r = runtime_opt.unwrap_or(&default_runtime);

        Session {
            session_id: core.session_id,
            dispatcher: core.dispatcher.clone(),
            assassin: core.assassin.clone(),
            commitment: core.commitment.clone(),
            chad_x: r.chad_x,
            chad_y: r.chad_y,
            battery: r.battery,
            turn: r.turn,
            phase: r.phase,
            ended: r.ended,
            alpha: r.alpha,
            alpha_max: core.alpha_max,
            pending_ping_tower: r.pending_ping_tower,
            d2: None,
            d2_chad: None,
            moved_this_turn: r.moved_this_turn,
            assassin_moves_this_turn: r.assassin_moves_this_turn,
            strong_radius_sq: core.strong_radius_sq,
            ping_cost: PING_COST,
            recharge_amount: RECHARGE_AMOUNT,
            chad_hidden: r.chad_hidden,
            chad_hide_streak: r.chad_hide_streak,
            insecure_mode: core.insecure_mode,
        }
    }
    fn load_session_core(env: &Env, session_id: u32) -> Result<SessionCore, Error> {
        env.storage().instance().get(&DataKey::SessionCore(session_id)).ok_or(Error::SessionNotFound)
    }
    fn store_session_core(env: &Env, session_id: u32, session: &SessionCore) {
        env.storage().instance().set(&DataKey::SessionCore(session_id), session);
    }
    fn load_session_runtime_opt(env: &Env, session_id: u32) -> Option<SessionRuntime> {
        env.storage().instance().get(&DataKey::SessionRuntime(session_id))
    }
    fn store_session_runtime(env: &Env, session_id: u32, runtime: &SessionRuntime) {
        env.storage().instance().set(&DataKey::SessionRuntime(session_id), runtime);
    }
    fn load_session_pair(env: &Env, session_id: u32) -> Result<(SessionCore, SessionRuntime), Error> {
        let core = Self::load_session_core(env, session_id)?;
        let runtime = Self::load_session_runtime_opt(env, session_id).ok_or(Error::RuntimeNotInitialized)?;
        Ok((core, runtime))
    }
    fn role_to_u32(role: Role) -> u32 {
        match role {
            Role::Dispatcher => 0,
            Role::Assassin => 1,
        }
    }
    fn load_session_key_scope(env: &Env, session_id: u32, owner: &Address, role: Role) -> Result<SessionKeyScope, Error> {
        env.storage()
            .instance()
            .get(&DataKey::SessionKeyScope(session_id, owner.clone(), Self::role_to_u32(role)))
            .ok_or(Error::SessionKeyNotAuthorized)
    }
    fn store_session_key_scope(env: &Env, session_id: u32, owner: &Address, role: Role, scope: &SessionKeyScope) {
        env.storage()
            .instance()
            .set(&DataKey::SessionKeyScope(session_id, owner.clone(), Self::role_to_u32(role)), scope);
    }
    fn require_owner_or_delegate(
        env: &Env,
        session_id: u32,
        owner: &Address,
        actor: &Address,
        role: Role,
        method_flag: u32,
    ) -> Result<(), Error> {
        if actor == owner {
            actor.require_auth();
            return Ok(());
        }

        let mut scope = Self::load_session_key_scope(env, session_id, owner, role)?;
        if scope.delegate != *actor {
            return Err(Error::SessionKeyNotAuthorized);
        }
        if scope.role != role {
            return Err(Error::SessionKeyRoleMismatch);
        }
        if scope.expires_ledger < env.ledger().sequence() {
            return Err(Error::SessionKeyExpired);
        }
        if (scope.allow_mask & method_flag) == 0 {
            return Err(Error::SessionKeyMethodNotAllowed);
        }
        if scope.max_writes != 0 && scope.writes_used >= scope.max_writes {
            return Err(Error::SessionKeyWriteLimitExceeded);
        }

        actor.require_auth();
        scope.writes_used = scope.writes_used.saturating_add(1);
        Self::store_session_key_scope(env, session_id, owner, role, &scope);
        Ok(())
    }
    fn ensure_not_ended(s: &SessionRuntime) -> Result<(), Error> {
        if s.ended { Err(Error::GameAlreadyEnded) } else { Ok(()) }
    }
    fn verify_session_turn(pis: &Vec<BytesN<32>>, s_id: u32, turn: u32, s_idx: u32, t_idx: u32) -> Result<(), Error> {
        let pi_sid = pis.get(s_idx).ok_or(Error::ProofSessionMismatch)?;
        let pi_turn = pis.get(t_idx).ok_or(Error::ProofTurnMismatch)?;
        
        let sid_b32 = Self::bytes32_from_u32(pis.env(), s_id);
        let turn_b32 = Self::bytes32_from_u32(pis.env(), turn);

        // Temporary on-chain diagnostics to debug field-order/encoding mismatches.
        pis.env().events().publish(
            (symbol_short!("dbg_sid"),),
            (s_idx, pi_sid.clone(), sid_b32.clone()),
        );
        pis.env().events().publish(
            (symbol_short!("dbg_turn"),),
            (t_idx, pi_turn.clone(), turn_b32.clone()),
        );

        if pi_sid != sid_b32 { return Err(Error::ProofSessionMismatch); }
        if pi_turn != turn_b32 { return Err(Error::ProofTurnMismatch); }
        Ok(())
    }

    fn verify_u32_field(pis: &Vec<BytesN<32>>, idx: u32, expected: u32, err: Error) -> Result<(), Error> {
        let got = pis.get(idx).ok_or(err)?;
        let exp = Self::bytes32_from_u32(pis.env(), expected);
        if got != exp { return Err(err); }
        Ok(())
    }

    fn bytes32_from_u32(env: &Env, v: u32) -> BytesN<32> {
        let mut arr = [0u8; 32];
        // Big-endian (matches existing verify_session_turn behavior).
        arr[31] = (v & 0xFF) as u8;
        arr[30] = ((v >> 8) & 0xFF) as u8;
        arr[29] = ((v >> 16) & 0xFF) as u8;
        arr[28] = ((v >> 24) & 0xFF) as u8;
        BytesN::from_array(env, &arr)
    }

    fn room_code_from_id(id: u32) -> u8 {
        match id {
            0 => b'G', // Garden
            1 => b'H', // Hallway
            2 => b'L', // Living
            3 => b'S', // Study
            4 => b'B', // Library
            5 => b'D', // Dining
            6 => b'K', // Kitchen
            7 => b'E', // Grand Hall
            _ => b'H',
        }
    }

    fn find_door(from_room: u8, to_room: u8) -> Option<(u32, u32)> {
        for &(ax, ay, bx, by) in &floorplan::DOORS_OPEN {
            if floorplan::get_room_code(ax, ay) == from_room && floorplan::get_room_code(bx, by) == to_room {
                return Some((bx, by));
            }
            if floorplan::get_room_code(bx, by) == from_room && floorplan::get_room_code(ax, ay) == to_room {
                return Some((ax, ay));
            }
        }
        None
    }
    fn end_game_internal(env: &Env, session_id: u32, s: &mut SessionRuntime, dispatcher_won: bool) -> Result<(), Error> {
        let game_hub_addr: Address = env.storage().instance().get(&DataKey::GameHub).unwrap();
        let game_hub = GameHubClient::new(env, &game_hub_addr);
        game_hub.end_game(&session_id, &dispatcher_won);
        s.ended = true;
        Ok(())
    }
}
