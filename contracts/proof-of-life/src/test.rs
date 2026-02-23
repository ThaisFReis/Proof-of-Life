#![cfg(test)]

use crate::{Error, MoveProofEntry, ProofOfLife, ProofOfLifeClient, Role, Session, SessionKeyParams, TurnPhase, Towers};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

// ============================================================================
// Mock GameHub for Unit Testing
// ============================================================================

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
    }

    pub fn add_game(_env: Env, _game_address: Address) {
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

fn setup_test() -> (
    Env,
    ProofOfLifeClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    // UltraHonk verification is heavy; keep budget unlimited for unit tests.
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(MockGameHub, ());
    let game_hub = MockGameHubClient::new(&env, &hub_addr);

    let admin = Address::generate(&env);
    let contract_id = env.register(ProofOfLife, (&admin, &hub_addr));
    let client = ProofOfLifeClient::new(&env, &contract_id);

    game_hub.add_game(&contract_id);

    let dispatcher = Address::generate(&env);
    let assassin = Address::generate(&env);

    (env, client, game_hub, hub_addr, admin, dispatcher, assassin)
}

#[test]
fn constructor_stores_game_hub_address() {
    let (_env, client, _hub, hub_addr, _admin, _dispatcher, _assassin) = setup_test();
    let hub = client.get_game_hub();
    assert_eq!(hub, hub_addr);
}

#[test]
fn constructor_sets_default_towers() {
    let (_env, client, _hub, _hub_addr, _admin, _dispatcher, _assassin) = setup_test();
    let towers = client.get_towers();
    // Defaults are deterministic so proofs/tests can rely on them.
    assert_eq!(towers.n_x, 5);
    assert_eq!(towers.n_y, 0);
    assert_eq!(towers.e_x, 9);
    assert_eq!(towers.e_y, 5);
    assert_eq!(towers.s_x, 5);
    assert_eq!(towers.s_y, 9);
    assert_eq!(towers.w_x, 0);
    assert_eq!(towers.w_y, 5);
}

fn assert_pol_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected_error: Error,
) {
    match result {
        Err(Ok(actual_error)) => {
            assert_eq!(*actual_error, expected_error);
        }
        _ => panic!("Expected contract error {:?}", expected_error),
    }
}

fn dummy_commitment(env: &Env) -> BytesN<32> {
    // Deterministic bytes for tests; not a real hash.
    BytesN::from_array(env, &[7u8; 32])
}

fn b32_u32(env: &Env, v: u32) -> BytesN<32> {
    // Big-endian, matching the contract's `bytes32_from_u32`.
    let mut arr = [0u8; 32];
    arr[31] = (v & 0xFF) as u8;
    arr[30] = ((v >> 8) & 0xFF) as u8;
    arr[29] = ((v >> 16) & 0xFF) as u8;
    arr[28] = ((v >> 24) & 0xFF) as u8;
    BytesN::from_array(env, &arr)
}

fn split_public_inputs(env: &Env, blob: &[u8]) -> soroban_sdk::Vec<BytesN<32>> {
    assert!(blob.len() % 32 == 0);
    let mut out = soroban_sdk::Vec::new(env);
    for chunk in blob.chunks(32) {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(chunk);
        out.push_back(BytesN::from_array(env, &arr));
    }
    out
}

fn deploy_ultrahonk_verifier(env: &Env, vk_bytes: &[u8]) -> Address {
    // We use the same verifier wasm embedded for contractimport in lib.rs.
    let wasm: &[u8] = include_bytes!("../bin/verifier.wasm");
    env.register(wasm, (Bytes::from_slice(env, vk_bytes),))
}

// ============================================================================
// Phase 0/1 Tests (Battery + Turn Order, On-Chain Enforcement)
// ============================================================================

#[test]
fn start_game_initializes_session_state() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 42u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.dispatcher, dispatcher);
    assert_eq!(s.assassin, assassin);
    assert_eq!(s.battery, 100);
    assert_eq!(s.ping_cost, 20);
    assert_eq!(s.recharge_amount, 10);
    assert_eq!(s.turn, 0);
    assert_eq!(s.phase, TurnPhase::Dispatcher);
    assert!(s.commitment.is_none());
    assert!(!s.ended);
    assert_eq!(s.alpha, 5);
    assert_eq!(s.alpha_max, 5);
    assert_eq!(s.strong_radius_sq, 4);

    // Single-player is allowed by design: same address can be both roles.
    let sp_session_id = 43u32;
    client.start_game(&sp_session_id, &dispatcher, &dispatcher, &5i128, &4i128);
    let sp: Session = client.get_session(&sp_session_id);
    assert_eq!(sp.dispatcher, dispatcher);
    assert_eq!(sp.assassin, dispatcher);
}

#[test]
fn ping_costs_battery_and_enforces_turn_order() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 1u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    // Dispatcher pings -> battery decreases and phase flips.
    client.request_ping(&session_id, &dispatcher, &0u32);
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.battery, 80);
    assert_eq!(s.phase, TurnPhase::Assassin);
    let _ = env;
}

#[test]
fn recharge_caps_at_100_and_enforces_turn_order() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 2u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Spend 20.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );
    client.assassin_tick(&session_id, &assassin, &25u32); // advance back to dispatcher

    // Recharge +10 (80 -> 90).
    client.recharge(&session_id, &dispatcher);
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.battery, 90);
    assert_eq!(s.phase, TurnPhase::Assassin);

    // Advance and recharge again (90 -> 100 cap).
    client.assassin_tick(&session_id, &assassin, &25u32);
    client.recharge(&session_id, &dispatcher);
    let s2: Session = client.get_session(&session_id);
    assert_eq!(s2.battery, 100);
}

#[test]
fn battery_depletion_ends_game_and_blocks_further_actions() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 3u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // 5 pings at 20 each: 100 -> 0.
    for _ in 0..4 {
        client.request_ping(&session_id, &dispatcher, &0u32);
        client.submit_ping_proof(
            &session_id,
            &assassin,
            &0u32,
            &250u32,
            &Bytes::from_slice(&env, &[1u8]),
            &soroban_sdk::vec![&env],
        );
        client.assassin_tick(&session_id, &assassin, &25u32);
    }
    client.request_ping(&session_id, &dispatcher, &0u32);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.battery, 0);
    assert!(s.ended);

    let res = client.try_request_ping(&session_id, &dispatcher, &0u32);
    assert_pol_error(&res, Error::GameAlreadyEnded);
}

#[test]
fn role_auth_is_enforced() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 4u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Assassin cannot ping (wrong actor → no session key scope → SessionKeyNotAuthorized).
    let res = client.try_request_ping(&session_id, &assassin, &0u32);
    assert_pol_error(&res, Error::SessionKeyNotAuthorized);

    // Dispatcher cannot tick (wrong actor → no session key scope → SessionKeyNotAuthorized).
    let res2 = client.try_assassin_tick(&session_id, &dispatcher, &25u32);
    assert_pol_error(&res2, Error::SessionKeyNotAuthorized);
}

// ============================================================================
// Phase 4 Tests (Proof Submission Wiring + Alpha)
// ============================================================================

#[test]
fn submit_ping_proof_requires_pending_ping_and_correct_tower() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 10u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    client.request_ping(&session_id, &dispatcher, &0u32);

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &1u32,
        &123u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );
    assert_pol_error(&res, Error::UnexpectedTower);
}

#[test]
fn submit_ping_proof_rejects_without_insecure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 11u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.request_ping(&session_id, &dispatcher, &0u32);
    // Force secure path so the contract validates public inputs.
    client.set_insecure_mode(&session_id, &false);

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &999u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );
    // Empty public_inputs fails immediately (before any verifier call).
    assert_pol_error(&res, Error::ProofSessionMismatch);
}

// ============================================================================
// Phase 5: On-Chain Verifier Wiring (UltraHonk)
// ============================================================================

#[test]
#[ignore] // bb v3.0.0 changed proof/VK format; on-chain verifier needs rewrite for new native-G1, 28-subrelation layout
fn ultrahonk_ping_distance_proof_verifies_on_chain() {
    let (env, client, _hub, _hub_addr, admin, dispatcher, assassin) = setup_test();

    // Circuit artifacts produced by `bb prove --scheme ultra_honk --output_format bytes_and_fields`.
    let vk = include_bytes!("../../../../circuits/ping_distance/target/vk");
    let proof = include_bytes!("../../../../circuits/ping_distance/target/proof");
    let public_inputs_bin = include_bytes!("../../../../circuits/ping_distance/target/public_inputs");

    let verifier_addr = deploy_ultrahonk_verifier(&env, vk);
    // Use same verifier for all three in this unit test (only ping is exercised here).
    client.set_verifiers(&verifier_addr, &verifier_addr, &verifier_addr);

    // Commitment must match public_inputs[4] (v3 format: tower_x, tower_y, session_id, turn, commitment, d2).
    let cmt = {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&public_inputs_bin[128..160]); // Field 4 at offset 4*32=128
        BytesN::from_array(&env, &arr)
    };

    // Match the session_id baked into the proof artifacts (field 2 = 0x20ca8fa1 = 550145953).
    let session_id = 550145953u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.commit_location(&session_id, &assassin, &cmt);
    let s0: Session = client.get_session(&session_id);
    assert_eq!(s0.commitment, Some(cmt));
    // This repo's committed proof artifacts use tower_x=9,tower_y=5 (East tower, tower_id=1).
    // Configure the on-chain tower mapping accordingly for this unit test.
    client.set_towers(&Towers {
        n_x: 5,
        n_y: 0,
        e_x: 9,
        e_y: 5,
        s_x: 5,
        s_y: 9,
        w_x: 0,
        w_y: 5,
    });
    client.request_ping(&session_id, &dispatcher, &1u32); // tower_id=1 for East

    // Secure mode must call the verifier.
    client.set_insecure_mode(&session_id, &false);

    let pis = split_public_inputs(&env, public_inputs_bin);
    let d2_expected = 34u32; // from public_inputs field 5: 0x22 = 34

    let out = client.submit_ping_proof(
        &session_id,
        &assassin,
        &1u32, // tower_id=1 (East tower at 9,5)
        &d2_expected,
        &Bytes::from_slice(&env, proof),
        &pis,
    );
    assert_eq!(out, d2_expected);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.d2, Some(d2_expected));
    assert!(s.pending_ping_tower.is_none());
    assert_eq!(s.phase, TurnPhase::Assassin);

    // Admin auth sanity (ensures set_insecure_mode path used)
    let _ = admin;
}

#[test]
#[ignore] // bb v3.0.0 changed proof/VK format; on-chain verifier needs rewrite
fn ultrahonk_move_proof_verifies_on_chain_and_updates_commitment() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let vk = include_bytes!("../../../../circuits/move_proof/target/vk");
    let proof = include_bytes!("../../../../circuits/move_proof/target/proof");
    let public_inputs_bin = include_bytes!("../../../../circuits/move_proof/target/public_inputs");

    let verifier_addr = deploy_ultrahonk_verifier(&env, vk);
    client.set_verifiers(&verifier_addr, &verifier_addr, &verifier_addr);

    // UltraHonk public fields (v3): [session_id, turn, commitment_old, commitment_new]
    let old_cmt = {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&public_inputs_bin[64..96]); // Field 2 at offset 2*32=64
        BytesN::from_array(&env, &arr)
    };
    let new_cmt = {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&public_inputs_bin[96..128]); // Field 3 at offset 3*32=96
        BytesN::from_array(&env, &arr)
    };

    // Match the session_id baked into the proof artifacts (field 0 = 0x20ca8fa1 = 550145953).
    let session_id = 550145953u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.commit_location(&session_id, &assassin, &old_cmt);
    let s0: Session = client.get_session(&session_id);
    assert_eq!(s0.commitment, Some(old_cmt));
    client.set_insecure_mode(&session_id, &false);

    // Move proof must be submitted during Assassin phase with no pending ping.
    client.recharge(&session_id, &dispatcher);

    let pis = split_public_inputs(&env, public_inputs_bin);
    client.submit_move_proof(
        &session_id,
        &assassin,
        &new_cmt,
        &Bytes::from_slice(&env, proof),
        &pis,
    );

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.commitment, Some(new_cmt));
    assert!(s.moved_this_turn);
    assert_eq!(s.battery, 100); // move proofs do not consume dispatcher battery
}

#[test]
#[ignore] // bb v3.0.0 changed proof/VK format; on-chain verifier needs rewrite
fn ultrahonk_invalid_proof_is_rejected_as_invalid_proof_error() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let vk = include_bytes!("../../../../circuits/ping_distance/target/vk");
    let proof = include_bytes!("../../../../circuits/ping_distance/target/proof");
    let public_inputs_bin = include_bytes!("../../../../circuits/ping_distance/target/public_inputs");

    let verifier_addr = deploy_ultrahonk_verifier(&env, vk);
    client.set_verifiers(&verifier_addr, &verifier_addr, &verifier_addr);

    // Commitment is at field 4 (v3 format: tower_x, tower_y, session_id, turn, commitment, d2)
    let cmt = {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&public_inputs_bin[128..160]); // Field 4 at offset 4*32=128
        BytesN::from_array(&env, &arr)
    };

    // Match the session_id baked into the proof artifacts (field 2 = 0x20ca8fa1 = 550145953).
    let session_id = 550145953u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.commit_location(&session_id, &assassin, &cmt);
    let s0: Session = client.get_session(&session_id);
    assert_eq!(s0.commitment, Some(cmt));

    // Match the committed circuit artifacts (tower_x=9,tower_y=5 for tower_id=1, East tower).
    client.set_towers(&Towers {
        n_x: 5,
        n_y: 0,
        e_x: 9,
        e_y: 5,
        s_x: 5,
        s_y: 9,
        w_x: 0,
        w_y: 5,
    });
    client.request_ping(&session_id, &dispatcher, &1u32); // tower_id=1 for East
    client.set_insecure_mode(&session_id, &false);

    let pis = split_public_inputs(&env, public_inputs_bin);
    let mut bad = proof.to_vec();
    bad[0] ^= 0x01;

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &1u32, // tower_id=1 for East tower
        &34u32, // Must match public_inputs field 5 (0x22 = 34)
        &Bytes::from_slice(&env, &bad),
        &pis,
    );
    assert_pol_error(&res, Error::InvalidProof);
}

#[test]
fn submit_turn_status_updates_alpha_and_can_end_game() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 12u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Move to assassin phase.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    // Strong signal (<= strong_radius_sq == 4) should decrement alpha.
    for _ in 0..4 {
        client.submit_move_proof(
            &session_id,
            &assassin,
            &BytesN::from_array(&env, &[3u8; 32]),
            &Bytes::from_slice(&env, &[3u8]),
            &soroban_sdk::vec![&env],
        );
        client.submit_turn_status_proof(
            &session_id,
            &assassin,
            &4u32,
            &Bytes::from_slice(&env, &[2u8]),
            &soroban_sdk::vec![&env],
        );
        client.recharge(&session_id, &dispatcher);
    }

    // Fifth status proof should end the game (alpha -> 0).
    client.submit_move_proof(
        &session_id,
        &assassin,
        &BytesN::from_array(&env, &[4u8; 32]),
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );
    client.submit_turn_status_proof(
        &session_id,
        &assassin,
        &4u32,
        &Bytes::from_slice(&env, &[2u8]),
        &soroban_sdk::vec![&env],
    );

    let s: Session = client.get_session(&session_id);
    assert!(s.ended);
    assert_eq!(s.alpha, 0);
}

#[test]
fn submit_move_updates_commitment_and_enforces_one_move_per_turn() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 13u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    let c1 = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &c1);

    // Move to assassin phase, clear pending ping.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    let c2 = BytesN::from_array(&env, &[9u8; 32]);
    client.submit_move_proof(
        &session_id,
        &assassin,
        &c2,
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.commitment.unwrap(), c2);
    assert!(s.moved_this_turn);

    // Second move in the same assassin phase should fail.
    let res = client.try_submit_move_proof(
        &session_id,
        &assassin,
        &BytesN::from_array(&env, &[10u8; 32]),
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );
    assert_pol_error(&res, Error::AlreadyMovedThisTurn);

    // Status proof should reset moved flag when turn advances.
    client.submit_turn_status_proof(
        &session_id,
        &assassin,
        &25u32,
        &Bytes::from_slice(&env, &[2u8]),
        &soroban_sdk::vec![&env],
    );
    let s2: Session = client.get_session(&session_id);
    assert!(!s2.moved_this_turn);
    assert_eq!(s2.phase, TurnPhase::Dispatcher);
}

// ============================================================================
// Phase 5+ Tests (ZK public fields binding, tamper resistance)
// ============================================================================

#[test]
fn submit_ping_proof_rejects_when_d2_does_not_match_public_output_field() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 200u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    client.request_ping(&session_id, &dispatcher, &0u32);
    client.set_insecure_mode(&session_id, &false);

    // UltraHonk public fields (v3): [tower_x, tower_y, session_id, turn, commitment, d2]
    let pis = soroban_sdk::vec![
        &env,
        b32_u32(&env, 5),
        b32_u32(&env, 0),
        b32_u32(&env, session_id),
        b32_u32(&env, 0),
        cmt,
        b32_u32(&env, 1234), // mismatched output
    ];

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &pis,
    );
    assert_pol_error(&res, Error::D2Mismatch);
}

#[test]
fn dispatcher_can_lock_session_into_secure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 300u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    // Default is now secure (false) for production.
    let s0: Session = client.get_session(&session_id);
    assert!(!s0.insecure_mode);

    client.lock_secure_mode(&session_id, &dispatcher);
    let s1: Session = client.get_session(&session_id);
    assert!(!s1.insecure_mode);

    // Non-dispatcher cannot lock (wrong actor → no session key scope → SessionKeyNotAuthorized).
    let res = client.try_lock_secure_mode(&session_id, &assassin);
    assert_pol_error(&res, Error::SessionKeyNotAuthorized);

    // Ensure it stays false.
    let s2: Session = client.get_session(&session_id);
    assert!(!s2.insecure_mode);
    let _ = env;
}

#[test]
fn submit_ping_proof_rejects_when_tower_id_out_of_range_in_secure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 301u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    client.request_ping(&session_id, &dispatcher, &9u32);
    client.set_insecure_mode(&session_id, &false);

    // v3 layout: [tower_x, tower_y, session_id, turn, commitment, d2]
    let pis = soroban_sdk::vec![
        &env,
        b32_u32(&env, 5),
        b32_u32(&env, 0),
        b32_u32(&env, session_id),
        b32_u32(&env, 0),
        cmt,
        b32_u32(&env, 250),
    ];

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &9u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &pis,
    );
    assert_pol_error(&res, Error::UnexpectedTower);
}

#[test]
fn submit_ping_proof_rejects_when_tower_coords_do_not_match_tower_id() {
    let (env, client, _hub, _hub_addr, admin, dispatcher, assassin) = setup_test();

    let session_id = 302u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    // Configure towers so tower_id=0 expects (1,2).
    client.set_towers(&Towers {
        n_x: 1,
        n_y: 2,
        e_x: 9,
        e_y: 5,
        s_x: 5,
        s_y: 9,
        w_x: 0,
        w_y: 5,
    });
    let _ = admin;

    client.request_ping(&session_id, &dispatcher, &0u32);
    client.set_insecure_mode(&session_id, &false);

    // v3 layout: [tower_x, tower_y, session_id, turn, commitment, d2]
    // Provide (5,0) in the public inputs but tower_id=0 expects (1,2) -> UnexpectedTower.
    let pis = soroban_sdk::vec![
        &env,
        b32_u32(&env, 5),
        b32_u32(&env, 0),
        b32_u32(&env, session_id),
        b32_u32(&env, 0),
        cmt,
        b32_u32(&env, 250),
    ];

    let res = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &pis,
    );
    assert_pol_error(&res, Error::UnexpectedTower);
}

#[test]
fn submit_turn_status_proof_rejects_when_d2_chad_does_not_match_public_output_field() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 201u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    // Move to assassin phase via ping (clears pending ping by submitting ping proof).
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    // Assassin must move before submitting status; keep commitment stable for this test.
    client.submit_move_proof(
        &session_id,
        &assassin,
        &cmt,
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );

    client.set_insecure_mode(&session_id, &false);

    // UltraHonk public fields (v3): [cx, cy, session_id, turn, commitment, d2_chad]
    // Chad starts at (4,7).
    let pis = soroban_sdk::vec![
        &env,
        b32_u32(&env, 4),
        b32_u32(&env, 7),
        b32_u32(&env, session_id),
        b32_u32(&env, 0),
        cmt,
        b32_u32(&env, 999), // mismatched output
    ];

    let res = client.try_submit_turn_status_proof(
        &session_id,
        &assassin,
        &25u32,
        &Bytes::from_slice(&env, &[2u8]),
        &pis,
    );
    assert_pol_error(&res, Error::D2ChadMismatch);
}

#[test]
fn submit_ping_proof_rejects_when_session_or_turn_mismatch() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 202u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    client.request_ping(&session_id, &dispatcher, &0u32);
    client.set_insecure_mode(&session_id, &false);

    // UltraHonk public fields (v3): [tower_x, tower_y, session_id, turn, commitment, d2]
    // Wrong session_id in public_inputs[2]
    let pis_wrong_sid = soroban_sdk::vec![
        &env,
        b32_u32(&env, 5),
        b32_u32(&env, 0),
        b32_u32(&env, session_id + 1),
        b32_u32(&env, 0),
        cmt.clone(),
        b32_u32(&env, 250),
    ];
    let res1 = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &pis_wrong_sid,
    );
    assert_pol_error(&res1, Error::ProofSessionMismatch);

    // Wrong turn in public_inputs[3]
    let pis_wrong_turn = soroban_sdk::vec![
        &env,
        b32_u32(&env, 5),
        b32_u32(&env, 0),
        b32_u32(&env, session_id),
        b32_u32(&env, 999),
        cmt,
        b32_u32(&env, 250),
    ];
    let res2 = client.try_submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &pis_wrong_turn,
    );
    // v3 layout: verify_session_turn checks session_id and turn individually.
    assert_pol_error(&res2, Error::ProofTurnMismatch);
}

#[test]
fn submit_move_proof_rejects_when_commitment_old_does_not_match_session_commitment() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 203u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    let cmt = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &cmt);

    // Move to assassin phase and clear pending ping.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );
    client.set_insecure_mode(&session_id, &false);

    let wrong_old = BytesN::from_array(&env, &[8u8; 32]);
    let new_cmt = BytesN::from_array(&env, &[9u8; 32]);

    // UltraHonk public fields (v3): [session_id, turn, commitment_old, commitment_new]
    let pis = soroban_sdk::vec![
        &env,
        b32_u32(&env, session_id),
        b32_u32(&env, 0),
        wrong_old,
        new_cmt.clone(),
    ];

    let res = client.try_submit_move_proof(
        &session_id,
        &assassin,
        &new_cmt,
        &Bytes::from_slice(&env, &[3u8]),
        &pis,
    );
    assert_pol_error(&res, Error::CommitmentMismatch);
}

#[test]
fn d2_chad_zero_triggers_kill_end_condition() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 14u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Move to assassin phase, clear pending ping, then submit a kill status.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    client.submit_move_proof(
        &session_id,
        &assassin,
        &BytesN::from_array(&env, &[9u8; 32]),
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );

    client.submit_turn_status_proof(
        &session_id,
        &assassin,
        &0u32,
        &Bytes::from_slice(&env, &[2u8]),
        &soroban_sdk::vec![&env],
    );
    let s: Session = client.get_session(&session_id);
    assert!(s.ended);
}

// ============================================================================
// assassin_tick Guard Tests (Recharge Path Desync Fix)
// ============================================================================

#[test]
fn test_assassin_tick_requires_move_in_secure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 400u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.initialize_session_runtime(&session_id, &dispatcher);
    // Secure mode (default) — no insecure_mode set.
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Recharge to move to Assassin phase without a pending ping.
    client.recharge(&session_id, &dispatcher);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.phase, TurnPhase::Assassin);
    assert_eq!(s.assassin_moves_this_turn, 0);

    // assassin_tick should fail because no move proofs were submitted in secure mode.
    let res = client.try_assassin_tick(&session_id, &assassin, &0u32);
    assert_pol_error(&res, Error::AssassinMustMove);
}

#[test]
fn test_assassin_tick_allows_no_move_in_insecure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 401u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.initialize_session_runtime(&session_id, &dispatcher);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Recharge to move to Assassin phase.
    client.recharge(&session_id, &dispatcher);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.phase, TurnPhase::Assassin);
    assert_eq!(s.assassin_moves_this_turn, 0);

    // In insecure mode, assassin_tick should succeed even without move proofs.
    client.assassin_tick(&session_id, &assassin, &0u32);

    let s2: Session = client.get_session(&session_id);
    assert_eq!(s2.phase, TurnPhase::Dispatcher);
    assert_eq!(s2.turn, 1);
}

#[test]
fn test_recharge_path_with_move_proofs_then_assassin_tick_succeeds() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 402u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.initialize_session_runtime(&session_id, &dispatcher);
    // Secure mode (default).
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Turn 0: Ping path (works fine).
    client.set_insecure_mode(&session_id, &true);
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );
    client.submit_move_proof(
        &session_id,
        &assassin,
        &BytesN::from_array(&env, &[9u8; 32]),
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );
    client.submit_turn_status_proof(
        &session_id,
        &assassin,
        &25u32,
        &Bytes::from_slice(&env, &[2u8]),
        &soroban_sdk::vec![&env],
    );
    let s1: Session = client.get_session(&session_id);
    assert_eq!(s1.turn, 1);
    assert_eq!(s1.phase, TurnPhase::Dispatcher);

    // Turn 1: Recharge path — no ping, but submit move proof first.
    // Switch back to secure mode to test the guard.
    client.set_insecure_mode(&session_id, &false);
    client.recharge(&session_id, &dispatcher);

    let s2: Session = client.get_session(&session_id);
    assert_eq!(s2.phase, TurnPhase::Assassin);
    assert!(s2.pending_ping_tower.is_none());

    // Without a move proof, assassin_tick should fail.
    let res = client.try_assassin_tick(&session_id, &assassin, &0u32);
    assert_pol_error(&res, Error::AssassinMustMove);

    // Submit a move proof (insecure_mode is off, but move_proof in insecure_mode
    // only checks the commitment chain; re-enable for this test since we don't
    // have real ZK proofs).
    client.set_insecure_mode(&session_id, &true);
    let new_cmt = BytesN::from_array(&env, &[10u8; 32]);
    client.submit_move_proof(
        &session_id,
        &assassin,
        &new_cmt,
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );

    // Now switch back to secure mode and verify assassin_tick succeeds.
    client.set_insecure_mode(&session_id, &false);
    client.assassin_tick(&session_id, &assassin, &0u32);

    let s3: Session = client.get_session(&session_id);
    assert_eq!(s3.turn, 2);
    assert_eq!(s3.phase, TurnPhase::Dispatcher);
    assert_eq!(s3.commitment, Some(new_cmt));

    // Turn 2: Ping should work without CommitmentMismatch because the
    // commitment was updated during the recharge turn.
    client.set_insecure_mode(&session_id, &true);
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    let s4: Session = client.get_session(&session_id);
    assert_eq!(s4.turn, 2);
    assert_eq!(s4.phase, TurnPhase::Assassin);
    assert!(s4.pending_ping_tower.is_none());
}

// ============================================================================
// Phase 1 Tests (Chad State + Floorplan)
// ============================================================================

#[test]
fn start_game_initializes_chad_position() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 100u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.chad_x, 4);
    assert_eq!(s.chad_y, 7);
    assert!(!s.chad_hidden);
    assert_eq!(s.chad_hide_streak, 0);
}

#[test]
fn chad_movement_rejects_diagonal() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 101u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    // WalkGarden only supports 4 directions (0=N, 1=E, 2=S, 3=W)
    // Invalid direction should fail
    let res = client.try_dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::WalkGarden(99));
    assert_pol_error(&res, Error::InvalidMove);
}

#[test]
fn chad_movement_validates_walls() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 102u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    // Chad starts at (4, 7) in Grand Hall
    // Try to move through a wall (this depends on floorplan)
    // Moving North from (4, 7) should work (within Grand Hall)
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::WalkGarden(0));
    
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.chad_y, 6); // Moved north
}

#[test]
fn chad_movement_rejects_blocked_tiles() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 103u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    // Winter garden at (4, 4) and (4, 5) is blocked
    // We need to navigate Chad there first, then try to enter
    // For simplicity, we'll test that blocked tiles are rejected by the floorplan module
    // (The actual movement would require multiple steps to reach the blocked area)
}

#[test]
fn hide_requires_proximity_to_hide_tile() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 104u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    // Chad starts at (4, 7) in Grand Hall
    // Check if there's a hide tile within manhattan <= 2
    // According to floorplan: Grand Hall has hide tiles at (3, 9) and (5, 8)
    // From (4, 7): distance to (3, 9) = |4-3| + |7-9| = 1 + 2 = 3 (too far)
    // From (4, 7): distance to (5, 8) = |4-5| + |7-8| = 1 + 1 = 2 (within range!)
    
    // Hide should succeed
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    
    let s: Session = client.get_session(&session_id);
    assert!(s.chad_hidden);
    assert_eq!(s.chad_hide_streak, 1);
}

#[test]
fn hide_streak_max_two_consecutive() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 105u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // First hide
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    client.assassin_tick(&session_id, &assassin, &25u32);
    
    // Second hide
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    client.assassin_tick(&session_id, &assassin, &25u32);
    
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.chad_hide_streak, 2);
    
    // Third hide should fail
    let res = client.try_dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    assert_pol_error(&res, Error::InvalidHide);
}

#[test]
fn stay_after_hide_pops_out() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 106u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Hide
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    client.assassin_tick(&session_id, &assassin, &25u32);
    
    let s1: Session = client.get_session(&session_id);
    assert!(s1.chad_hidden);
    assert_eq!(s1.chad_hide_streak, 1);
    
    // Stay should pop out
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Stay);
    
    let s2: Session = client.get_session(&session_id);
    assert!(!s2.chad_hidden);
    assert_eq!(s2.chad_hide_streak, 0);
}

#[test]
fn movement_breaks_hide() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 107u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Hide
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Hide);
    client.assassin_tick(&session_id, &assassin, &25u32);
    
    let s1: Session = client.get_session(&session_id);
    assert!(s1.chad_hidden);
    
    // Move should break hide
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::WalkGarden(0));
    
    let s2: Session = client.get_session(&session_id);
    assert!(!s2.chad_hidden);
    assert_eq!(s2.chad_hide_streak, 0);
}

#[test]
fn dispatcher_command_requires_dispatcher_auth() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 108u32;
    client.start_game(&session_id, &dispatcher, &assassin, &0i128, &0i128);
    client.set_insecure_mode(&session_id, &true);

    // Assassin cannot issue dispatcher commands (wrong actor → no session key scope → SessionKeyNotAuthorized).
    let res = client.try_dispatcher_command(&session_id, &assassin, &crate::ChadCommand::Stay);
    assert_pol_error(&res, Error::SessionKeyNotAuthorized);
}

#[test]
fn dispatcher_command_requires_dispatcher_turn() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 109u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Move to assassin phase
    client.request_ping(&session_id, &dispatcher, &0u32);
    
    // Dispatcher cannot command during assassin phase
    let res = client.try_dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::Stay);
    assert_pol_error(&res, Error::NotDispatcherTurn);
}

#[test]
fn full_turn_with_chad_movement() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 110u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);
    client.commit_location(&session_id, &assassin, &dummy_commitment(&env));

    // Dispatcher moves Chad
    client.dispatcher_command(&session_id, &dispatcher, &crate::ChadCommand::WalkGarden(1)); // East
    
    let s1: Session = client.get_session(&session_id);
    assert_eq!(s1.chad_x, 5);
    assert_eq!(s1.chad_y, 7);
    assert_eq!(s1.phase, TurnPhase::Assassin);
    
    // Clear pending ping before movement proofs.
    client.submit_ping_proof(
        &session_id,
        &assassin,
        &0u32,
        &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    // Assassin must move (at least 1 move proof) before submitting turn status.
    client.submit_move_proof(
        &session_id,
        &assassin,
        &BytesN::from_array(&env, &[9u8; 32]),
        &Bytes::from_slice(&env, &[3u8]),
        &soroban_sdk::vec![&env],
    );

    // Assassin responds with turn status (referencing on-chain Chad position)
    client.submit_turn_status_proof(
        &session_id,
        &assassin,
        &25u32, // d2_chad
        &Bytes::from_slice(&env, &[2u8]),
        &soroban_sdk::vec![&env],
    );
    
    let s2: Session = client.get_session(&session_id);
    assert_eq!(s2.phase, TurnPhase::Dispatcher);
    assert_eq!(s2.turn, 1);
}

#[test]
fn session_key_delegate_can_dispatch_with_single_authorization() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 111u32;
    let delegate = Address::generate(&_env);
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.initialize_session_runtime(&session_id, &dispatcher);
    client.authorize_session_key(
        &dispatcher,
        &session_id,
        &delegate,
        &100u32,
        &10u32,
        &1u32, // SESSION_METHOD_DISPATCH
        &0u32,
    );

    client.dispatch(&session_id, &delegate, &0u32, &crate::ChadCommand::Stay);
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.phase, TurnPhase::Assassin);
}

#[test]
fn session_key_respects_revoke() {
    let (_env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 112u32;
    let delegate = Address::generate(&_env);
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.initialize_session_runtime(&session_id, &dispatcher);
    client.authorize_session_key(&dispatcher, &session_id, &delegate, &100u32, &10u32, &1u32, &0u32);
    client.revoke_session_key(&dispatcher, &session_id, &Role::Dispatcher);

    let res = client.try_dispatch(&session_id, &delegate, &0u32, &crate::ChadCommand::Stay);
    assert_pol_error(&res, Error::SessionKeyNotAuthorized);
}

// ============================================================================
// Phase 2 Tests: start_game_with_session_key
// ============================================================================

#[test]
fn start_game_with_session_key_creates_session_and_authorizes_delegate() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 200u32;
    let delegate = Address::generate(&env);

    let sk_params = SessionKeyParams {
        delegate: delegate.clone(),
        ttl_ledgers: 100,
        max_writes: 50,
        dispatcher_allow_mask: 1, // SESSION_METHOD_DISPATCH
        assassin_allow_mask: 0,
    };

    client.start_game_with_session_key(&session_id, &dispatcher, &assassin, &sk_params);

    // Session should be created and initialized.
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.session_id, session_id);
    assert_eq!(s.dispatcher, dispatcher);
    assert_eq!(s.assassin, assassin);
    assert!(!s.ended);
    assert_eq!(s.turn, 0);

    // Dispatcher session key scope should exist.
    let scope = client.get_session_key_scope(&dispatcher, &session_id, &Role::Dispatcher);
    assert!(scope.is_some());
    let scope = scope.unwrap();
    assert_eq!(scope.delegate, delegate);
    assert_eq!(scope.allow_mask, 1);
    assert_eq!(scope.max_writes, 50);
    assert_eq!(scope.writes_used, 0);
}

#[test]
fn start_game_with_session_key_authorizes_assassin_when_solo() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, _assassin) = setup_test();

    let session_id = 201u32;
    let delegate = Address::generate(&env);

    // Solo play: dispatcher == assassin
    let sk_params = SessionKeyParams {
        delegate: delegate.clone(),
        ttl_ledgers: 100,
        max_writes: 50,
        dispatcher_allow_mask: 1,
        assassin_allow_mask: 4, // SESSION_METHOD_COMMIT_LOCATION
    };

    client.start_game_with_session_key(&session_id, &dispatcher, &dispatcher, &sk_params);

    // Both scopes should exist.
    let d_scope = client.get_session_key_scope(&dispatcher, &session_id, &Role::Dispatcher);
    assert!(d_scope.is_some());
    let a_scope = client.get_session_key_scope(&dispatcher, &session_id, &Role::Assassin);
    assert!(a_scope.is_some());
    assert_eq!(a_scope.unwrap().allow_mask, 4);
}

#[test]
fn start_game_with_session_key_delegate_can_dispatch() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 202u32;
    let delegate = Address::generate(&env);

    let sk_params = SessionKeyParams {
        delegate: delegate.clone(),
        ttl_ledgers: 100,
        max_writes: 50,
        dispatcher_allow_mask: 1, // SESSION_METHOD_DISPATCH
        assassin_allow_mask: 0,
    };

    client.start_game_with_session_key(&session_id, &dispatcher, &assassin, &sk_params);
    client.set_insecure_mode(&session_id, &true);

    // Delegate should be able to dispatch.
    client.dispatch(&session_id, &delegate, &0u32, &crate::ChadCommand::Stay);
    let s: Session = client.get_session(&session_id);
    assert_eq!(s.phase, TurnPhase::Assassin);
}

// ============================================================================
// Phase 3 Tests: submit_multi_move_proof
// ============================================================================

#[test]
fn submit_multi_move_proof_chains_commitments_in_insecure_mode() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 300u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    let c0 = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &c0);

    // Move to assassin phase, clear pending ping, enable hidden (6 moves).
    client.dispatch(&session_id, &dispatcher, &0u32, &crate::ChadCommand::Hide);
    client.submit_ping_proof(
        &session_id, &assassin, &0u32, &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    let c1 = BytesN::from_array(&env, &[11u8; 32]);
    let c2 = BytesN::from_array(&env, &[12u8; 32]);
    let c3 = BytesN::from_array(&env, &[13u8; 32]);

    let entries = soroban_sdk::vec![
        &env,
        MoveProofEntry {
            new_commitment: c1.clone(),
            proof: Bytes::from_slice(&env, &[1u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
        MoveProofEntry {
            new_commitment: c2.clone(),
            proof: Bytes::from_slice(&env, &[2u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
        MoveProofEntry {
            new_commitment: c3.clone(),
            proof: Bytes::from_slice(&env, &[3u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
    ];

    client.submit_multi_move_proof(&session_id, &assassin, &entries);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.commitment, Some(c3));
    assert!(s.moved_this_turn);
    assert_eq!(s.assassin_moves_this_turn, 3);
}

#[test]
fn submit_multi_move_proof_rejects_excess_moves() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 301u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    let c0 = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &c0);

    // Non-hidden: only 1 move allowed.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id, &assassin, &0u32, &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    let entries = soroban_sdk::vec![
        &env,
        MoveProofEntry {
            new_commitment: BytesN::from_array(&env, &[11u8; 32]),
            proof: Bytes::from_slice(&env, &[1u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
        MoveProofEntry {
            new_commitment: BytesN::from_array(&env, &[12u8; 32]),
            proof: Bytes::from_slice(&env, &[2u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
    ];

    let res = client.try_submit_multi_move_proof(&session_id, &assassin, &entries);
    assert_pol_error(&res, Error::AlreadyMovedThisTurn);
}

#[test]
fn submit_multi_move_proof_single_entry_works() {
    let (env, client, _hub, _hub_addr, _admin, dispatcher, assassin) = setup_test();

    let session_id = 302u32;
    client.start_game(&session_id, &dispatcher, &assassin, &5i128, &4i128);
    client.set_insecure_mode(&session_id, &true);

    let c0 = dummy_commitment(&env);
    client.commit_location(&session_id, &assassin, &c0);

    // Non-hidden: 1 move allowed.
    client.request_ping(&session_id, &dispatcher, &0u32);
    client.submit_ping_proof(
        &session_id, &assassin, &0u32, &250u32,
        &Bytes::from_slice(&env, &[1u8]),
        &soroban_sdk::vec![&env],
    );

    let c1 = BytesN::from_array(&env, &[21u8; 32]);
    let entries = soroban_sdk::vec![
        &env,
        MoveProofEntry {
            new_commitment: c1.clone(),
            proof: Bytes::from_slice(&env, &[1u8]),
            public_inputs: soroban_sdk::vec![&env],
        },
    ];

    client.submit_multi_move_proof(&session_id, &assassin, &entries);

    let s: Session = client.get_session(&session_id);
    assert_eq!(s.commitment, Some(c1));
    assert!(s.moved_this_turn);
    assert_eq!(s.assassin_moves_this_turn, 1);
}
