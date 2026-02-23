#![no_std]

//! Groth16 ZK Proof Verifier for Soroban (BN254)
//!
//! This contract verifies Groth16 zero-knowledge proofs using Soroban's native
//! BN254 (alt_bn128) elliptic curve host functions. It is designed to be called
//! cross-contract by game contracts that need proof verification.
//!
//! ## Architecture
//!
//! - An admin stores a **verification key** (VK) per circuit identifier.
//! - Any contract (or user) can call `verify_groth16` with a proof and public
//!   inputs; the contract returns `true` iff the Groth16 pairing equation holds.
//! - The heavy cryptographic operations (point arithmetic, pairing) are executed
//!   by Soroban host functions — no custom field math is needed.
//!
//! ## Groth16 verification equation
//!
//! Given VK = (α₁, β₂, γ₂, δ₂, IC[0..n]) and proof = (A₁, B₂, C₁):
//!
//! 1. Compute  vk_x = IC[0] + Σ(input[i] · IC[i+1])
//! 2. Check    e(A, B) · e(−vk_x, γ) · e(−C, δ) · e(−α, β) = 1
//!
//! The last step is a single call to `bn254::pairing_check`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    vec, Address, BytesN, Env, Vec,
};

#[cfg(test)]
mod test;

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    NotAdmin = 1,
    VkNotFound = 2,
    PublicInputCountMismatch = 3,
    InvalidProof = 4,
}

// ============================================================================
// Data Types
// ============================================================================

/// A Groth16 verification key over BN254.
///
/// Serialization sizes (Ethereum / Soroban convention, uncompressed):
/// - G1 point: 64 bytes  (be(X) || be(Y), each 32-byte Fp element)
/// - G2 point: 128 bytes (be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0))
/// - Scalar (Fr): 32 bytes (big-endian)
#[contracttype]
#[derive(Clone, Debug)]
pub struct Groth16Vk {
    /// α ∈ G1
    pub alpha_g1: BytesN<64>,
    /// β ∈ G2
    pub beta_g2: BytesN<128>,
    /// γ ∈ G2
    pub gamma_g2: BytesN<128>,
    /// δ ∈ G2
    pub delta_g2: BytesN<128>,
    /// IC points ∈ G1.  Length = (number of public inputs) + 1.
    pub ic: Vec<BytesN<64>>,
}

/// A Groth16 proof over BN254 (3 curve elements).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Groth16Proof {
    /// A ∈ G1
    pub a: BytesN<64>,
    /// B ∈ G2
    pub b: BytesN<128>,
    /// C ∈ G1
    pub c: BytesN<64>,
}

// ============================================================================
// Storage
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// VK stored per circuit identifier (0 = ping_distance, 1 = turn_status, 2 = move_proof).
    Vk(u32),
}

const VK_TTL_LEDGERS: u32 = 518_400; // ~30 days

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct ZkVerifierContract;

#[contractimpl]
impl ZkVerifierContract {
    /// Deploy with an admin address.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // ----- Admin: store verification keys -----------------------------------

    /// Store (or replace) the verification key for a given circuit.
    pub fn store_vk(
        env: Env,
        admin: Address,
        circuit_id: u32,
        vk: Groth16Vk,
    ) -> Result<(), VerifierError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        if admin != stored {
            return Err(VerifierError::NotAdmin);
        }

        let key = DataKey::Vk(circuit_id);
        env.storage().persistent().set(&key, &vk);
        env.storage()
            .persistent()
            .extend_ttl(&key, VK_TTL_LEDGERS, VK_TTL_LEDGERS);
        Ok(())
    }

    /// Read back a stored VK (for inspection / debugging).
    pub fn get_vk(env: Env, circuit_id: u32) -> Result<Groth16Vk, VerifierError> {
        let key = DataKey::Vk(circuit_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(VerifierError::VkNotFound)
    }

    // ----- Verification -----------------------------------------------------

    /// Verify a Groth16 proof against the stored VK for `circuit_id`.
    ///
    /// `public_inputs` is a vector of BN254 scalar field elements (Fr), each
    /// encoded as a big-endian `BytesN<32>`.
    ///
    /// Returns `true` if the proof is valid.
    pub fn verify_groth16(
        env: Env,
        circuit_id: u32,
        proof: Groth16Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, VerifierError> {
        let vk = Self::get_vk(env.clone(), circuit_id)?;

        // IC length must be public_inputs.len() + 1
        let n_inputs = public_inputs.len();
        if vk.ic.len() != n_inputs + 1 {
            return Err(VerifierError::PublicInputCountMismatch);
        }

        let bn254 = env.crypto().bn254();

        // --- Step 1: compute vk_x = IC[0] + Σ(input[i] · IC[i+1]) ----------

        let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());

        for i in 0..n_inputs {
            let scalar = Fr::from_bytes(public_inputs.get(i).unwrap());
            let ic_point = Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
            let term = bn254.g1_mul(&ic_point, &scalar);
            vk_x = bn254.g1_add(&vk_x, &term);
        }

        // --- Step 2: pairing check ------------------------------------------
        //
        // Groth16 equation:
        //   e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)
        //
        // Rearranged for pairing_check (product must equal 1 in GT):
        //   e(A, B) · e(−α, β) · e(−vk_x, γ) · e(−C, δ) = 1

        let a = Bn254G1Affine::from_bytes(proof.a);
        let b = Bn254G2Affine::from_bytes(proof.b);
        let c = Bn254G1Affine::from_bytes(proof.c);

        let alpha = Bn254G1Affine::from_bytes(vk.alpha_g1);
        let beta = Bn254G2Affine::from_bytes(vk.beta_g2);
        let gamma = Bn254G2Affine::from_bytes(vk.gamma_g2);
        let delta = Bn254G2Affine::from_bytes(vk.delta_g2);

        let neg_alpha = -alpha;
        let neg_vk_x = -vk_x;
        let neg_c = -c;

        let g1_vec: Vec<Bn254G1Affine> = vec![&env, a, neg_alpha, neg_vk_x, neg_c];
        let g2_vec: Vec<Bn254G2Affine> = vec![&env, b, beta, gamma, delta];

        let ok = bn254.pairing_check(g1_vec, g2_vec);
        Ok(ok)
    }
}
