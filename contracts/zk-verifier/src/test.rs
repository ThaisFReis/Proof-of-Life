#![cfg(test)]

use crate::{Groth16Proof, Groth16Vk, VerifierError, ZkVerifierContract, ZkVerifierContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, Address, BytesN, Env, Vec};

// ============================================================================
// BN254 Generator Constants (Ethereum / Soroban convention, uncompressed)
// ============================================================================

/// G1 generator: (1, 2) — the standard BN254 generator.
/// Encoding: be(X=1, 32 bytes) || be(Y=2, 32 bytes) = 64 bytes.
fn g1_generator(env: &Env) -> BytesN<64> {
    let mut bytes = [0u8; 64];
    bytes[31] = 1; // X = 1
    bytes[63] = 2; // Y = 2
    BytesN::from_array(env, &bytes)
}

/// G2 generator — the standard BN254 G2 generator from EIP-197.
///
/// Encoding: be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0) = 128 bytes.
///
/// X.c1 = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2
/// X.c0 = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed
/// Y.c1 = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b
/// Y.c0 = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa
fn g2_generator(env: &Env) -> BytesN<128> {
    let bytes: [u8; 128] = [
        // X.c1 (imaginary)
        0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb,
        0x5d, 0x25, 0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7,
        0xae, 0xf3, 0x12, 0xc2,
        // X.c0 (real)
        0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c,
        0x44, 0x79, 0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46, 0xde, 0xbd, 0x5c,
        0xd9, 0x92, 0xf6, 0xed,
        // Y.c1 (imaginary)
        0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c,
        0x33, 0x95, 0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc,
        0xd1, 0x22, 0x97, 0x5b,
        // Y.c0 (real)
        0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb,
        0x40, 0x8f, 0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01,
        0x66, 0xfa, 0x7d, 0xaa,
    ];
    BytesN::from_array(env, &bytes)
}

/// The G1 identity / point at infinity (all zeros).
fn g1_zero(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; 64])
}

// ============================================================================
// Test Helpers
// ============================================================================

fn setup_test() -> (Env, ZkVerifierContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_441_065_600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let admin = Address::generate(&env);
    let contract_id = env.register(ZkVerifierContract, (&admin,));
    let client = ZkVerifierContractClient::new(&env, &contract_id);

    (env, client, admin)
}

/// Build a VK for a "zero-constraint, zero-input" circuit.
///
/// For this degenerate circuit the Groth16 equation simplifies to:
///   e(A, B) · e(−α, β) · e(−IC₀, γ) · e(−C, δ) = 1
///
/// With α = G1, β = G2, γ = G2, δ = G2, IC = [O]  (G1 zero):
///   e(A, B) · e(−G1, G2) · e(O, G2) · e(−C, G2) = 1
///   e(A, B) · e(−G1, G2) · e(−C, G2) = 1
///
/// A valid proof: A = G1, B = G2, C = O (identity):
///   e(G1, G2) · e(−G1, G2) · e(O, G2) = 1  ✓
///
/// Because e(P, Q) · e(−P, Q) = e(P+(-P), Q) = e(O, Q) = 1.
fn degenerate_vk(env: &Env) -> Groth16Vk {
    Groth16Vk {
        alpha_g1: g1_generator(env),
        beta_g2: g2_generator(env),
        gamma_g2: g2_generator(env),
        delta_g2: g2_generator(env),
        ic: vec![env, g1_zero(env)], // one IC point (zero inputs), set to identity
    }
}

fn valid_proof(env: &Env) -> Groth16Proof {
    Groth16Proof {
        a: g1_generator(env),  // A = G1
        b: g2_generator(env),  // B = G2
        c: g1_zero(env),       // C = O (identity)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn store_and_retrieve_vk() {
    let (env, client, admin) = setup_test();

    let vk = degenerate_vk(&env);
    client.store_vk(&admin, &0u32, &vk);

    let retrieved = client.get_vk(&0u32);
    assert_eq!(retrieved.alpha_g1, vk.alpha_g1);
    assert_eq!(retrieved.ic.len(), 1);
}

#[test]
fn vk_not_found_returns_error() {
    let (_env, client, _admin) = setup_test();

    let res = client.try_get_vk(&99u32);
    match res {
        Err(Ok(e)) => assert_eq!(e, VerifierError::VkNotFound),
        _ => panic!("expected VkNotFound error"),
    }
}

#[test]
fn valid_proof_is_accepted() {
    let (env, client, admin) = setup_test();

    let vk = degenerate_vk(&env);
    client.store_vk(&admin, &0u32, &vk);

    let proof = valid_proof(&env);
    let public_inputs: Vec<BytesN<32>> = vec![&env]; // zero public inputs

    let result = client.verify_groth16(&0u32, &proof, &public_inputs);
    assert!(result, "valid proof must be accepted");
}

#[test]
fn tampered_proof_a_is_rejected() {
    let (env, client, admin) = setup_test();

    let vk = degenerate_vk(&env);
    client.store_vk(&admin, &0u32, &vk);

    // Tamper: use 2·G1 for proof.a instead of G1.
    // This breaks the pairing equation because e(2G1, G2) ≠ e(G1, G2).
    let two_g1 = {
        let bn = env.crypto().bn254();
        let g = soroban_sdk::crypto::bn254::Bn254G1Affine::from_bytes(g1_generator(&env));
        let doubled = bn.g1_add(&g, &g);
        doubled.to_bytes()
    };

    let bad_proof = Groth16Proof {
        a: two_g1,
        b: g2_generator(&env),
        c: g1_zero(&env),
    };
    let public_inputs: Vec<BytesN<32>> = vec![&env];

    let result = client.verify_groth16(&0u32, &bad_proof, &public_inputs);
    assert!(!result, "tampered proof.a must be rejected");
}

#[test]
fn tampered_proof_c_is_rejected() {
    let (env, client, admin) = setup_test();

    let vk = degenerate_vk(&env);
    client.store_vk(&admin, &0u32, &vk);

    // Tamper: use G1 (not identity) for proof.c.
    let bad_proof = Groth16Proof {
        a: g1_generator(&env),
        b: g2_generator(&env),
        c: g1_generator(&env), // should be zero
    };
    let public_inputs: Vec<BytesN<32>> = vec![&env];

    let result = client.verify_groth16(&0u32, &bad_proof, &public_inputs);
    assert!(!result, "tampered proof.c must be rejected");
}

#[test]
fn wrong_public_input_count_is_rejected() {
    let (env, client, admin) = setup_test();

    let vk = degenerate_vk(&env); // expects 0 public inputs (ic.len() == 1)
    client.store_vk(&admin, &0u32, &vk);

    let proof = valid_proof(&env);
    // Supply 1 public input when VK expects 0.
    let bad_inputs: Vec<BytesN<32>> = vec![&env, BytesN::from_array(&env, &[1u8; 32])];

    let res = client.try_verify_groth16(&0u32, &proof, &bad_inputs);
    match res {
        Err(Ok(e)) => assert_eq!(e, VerifierError::PublicInputCountMismatch),
        _ => panic!("expected PublicInputCountMismatch error"),
    }
}

#[test]
fn only_admin_can_store_vk() {
    let (env, client, _admin) = setup_test();

    let imposter = Address::generate(&env);
    let vk = degenerate_vk(&env);
    let res = client.try_store_vk(&imposter, &0u32, &vk);
    match res {
        Err(Ok(e)) => assert_eq!(e, VerifierError::NotAdmin),
        _ => panic!("expected NotAdmin error"),
    }
}

#[test]
fn vk_with_public_inputs_works() {
    let (env, client, admin) = setup_test();

    // Build a VK with 1 public input.
    // IC = [IC₀, IC₁] where IC₀ = O (identity), IC₁ = G1.
    //
    // vk_x = IC₀ + input[0]·IC₁ = O + input[0]·G1 = input[0]·G1
    //
    // For the equation to hold with A = α = G1, B = β = G2, C = O:
    //   e(G1, G2) · e(−G1, G2) · e(−input[0]·G1, G2) · e(O, G2) = 1
    //   e(G1, G2) · e(−G1, G2) · e(−input[0]·G1, G2) = 1
    //   1 · e(−input[0]·G1, G2) = 1
    //
    // This holds only when input[0] = 0 (so that input[0]·G1 = O).
    let vk = Groth16Vk {
        alpha_g1: g1_generator(&env),
        beta_g2: g2_generator(&env),
        gamma_g2: g2_generator(&env),
        delta_g2: g2_generator(&env),
        ic: vec![&env, g1_zero(&env), g1_generator(&env)], // IC₀ = O, IC₁ = G1
    };
    client.store_vk(&admin, &0u32, &vk);

    let proof = valid_proof(&env);

    // input[0] = 0  → should pass
    let zero_input = BytesN::from_array(&env, &[0u8; 32]);
    let inputs_ok: Vec<BytesN<32>> = vec![&env, zero_input];
    assert!(
        client.verify_groth16(&0u32, &proof, &inputs_ok),
        "input=0 must pass"
    );

    // input[0] = 1  → should fail
    let mut one_bytes = [0u8; 32];
    one_bytes[31] = 1;
    let one_input = BytesN::from_array(&env, &one_bytes);
    let inputs_bad: Vec<BytesN<32>> = vec![&env, one_input];
    assert!(
        !client.verify_groth16(&0u32, &proof, &inputs_bad),
        "input=1 must fail"
    );
}
