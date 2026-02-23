//! UltraHonk verifier

use crate::{
    field::Fr,
    shplemini::verify_shplemini,
    sumcheck::verify_sumcheck,
    transcript::generate_transcript,
    types::PAIRING_POINTS_SIZE,
    utils::{load_proof, load_vk_from_bytes, proof_bytes_for_log_n},
};
use crate::trace;
use soroban_sdk::{Bytes, Env, symbol_short};

/// Error type describing the specific reason verification failed.
#[derive(Debug)]
pub enum VerifyError {
    InvalidInput(&'static str),
    SumcheckFailed(&'static str),
    ShplonkFailed(&'static str),
}

pub struct UltraHonkVerifier {
    env: Env,
    vk: crate::types::VerificationKey,
    vk_hash: [u8; 32],
}

impl UltraHonkVerifier {
    pub fn new_with_vk(env: &Env, vk: crate::types::VerificationKey) -> Self {
        Self {
            env: env.clone(),
            vk,
            vk_hash: [0u8; 32], // zeroed when VK bytes not available
        }
    }

    /// Create from raw VK bytes.
    /// The input format is: [32-byte vk_hash] + [VK binary data].
    /// The vk_hash is the bb-generated keccak256 hash of the VK encoding.
    pub fn new(env: &Env, vk_bytes: &Bytes) -> Result<Self, VerifyError> {
        if vk_bytes.len() < 32 {
            return Err(VerifyError::InvalidInput("vk too short for hash prefix"));
        }
        // First 32 bytes = precomputed vk_hash
        let mut vk_hash = [0u8; 32];
        vk_bytes.slice(0..32).copy_into_slice(&mut vk_hash);

        // Remaining bytes = actual VK binary
        let vk_data = vk_bytes.slice(32..vk_bytes.len());
        let vk = load_vk_from_bytes(&vk_data)
            .ok_or(VerifyError::InvalidInput("vk parse error"))?;

        Ok(Self {
            env: env.clone(),
            vk,
            vk_hash,
        })
    }

    /// Expose a reference to the parsed VK for debugging/inspection.
    pub fn get_vk(&self) -> &crate::types::VerificationKey {
        &self.vk
    }

    /// Top-level verify
    pub fn verify(
        &self,
        proof_bytes: &Bytes,
        public_inputs_bytes: &Bytes,
    ) -> Result<(), VerifyError> {
        let log_n = self.vk.log_circuit_size as usize;

        // 1) parse proof (size depends on log_n)
        let expected_proof_bytes = proof_bytes_for_log_n(self.vk.log_circuit_size);
        if proof_bytes.len() as usize != expected_proof_bytes {
            return Err(VerifyError::InvalidInput("proof size mismatch"));
        }
        let proof = load_proof(proof_bytes, log_n);

        // 2) sanity on public inputs (length and VK metadata if present)
        if public_inputs_bytes.len() % 32 != 0 {
            return Err(VerifyError::InvalidInput(
                "public inputs must be 32-byte aligned",
            ));
        }
        let provided = (public_inputs_bytes.len() / 32) as u64;
        let vk_inputs = self.vk.public_inputs_size;

        self.env.events().publish(
            (symbol_short!("log"), symbol_short!("ver_start")),
            (provided, vk_inputs),
        );

        // Allowed interpretations of VK public inputs count:
        // 1. VK includes pairing fields (recursive wrapper expectation): expected = vk_inputs - 16
        // 2. VK excludes pairing fields (raw circuit output): expected = vk_inputs
        let expected_recursive = vk_inputs.checked_sub(PAIRING_POINTS_SIZE as u64);

        let valid = if vk_inputs == provided {
            true // VK count matches user inputs exactly (bb 3.0.0 behavior for root circuits)
        } else if let Some(exp) = expected_recursive {
            exp == provided // VK count includes recursion fields
        } else {
            false
        };

        if !valid {
            self.env.events().publish(
                (symbol_short!("err"), symbol_short!("pi_len")),
                (provided, vk_inputs),
            );
            return Err(VerifyError::InvalidInput("public inputs mismatch (vk vs provided)"));
        }

        // 3) Fiat–Shamir transcript
        // Use pub_inputs_offset from VK, and total public inputs = provided + pairing size
        let pis_total = provided + PAIRING_POINTS_SIZE as u64;
        let pub_inputs_offset = self.vk.pub_inputs_offset;
        trace!("[verifier] vk_hash = 0x{}", hex::encode(self.vk_hash));
        trace!("[verifier] circuit_size = {}, log_n = {}", self.vk.circuit_size, log_n);
        trace!("[verifier] pis_total = {}, pub_inputs_offset = {}", pis_total, pub_inputs_offset);
        trace!("[verifier] proof_bytes = {} bytes", proof_bytes.len());
        let mut t = generate_transcript(
            &self.env,
            &proof,
            public_inputs_bytes,
            &self.vk_hash,
            self.vk.circuit_size,
            pis_total,
            pub_inputs_offset,
        );

        trace!("[verifier] public_inputs_delta computing...");
        // 4) Public delta
        t.rel_params.public_inputs_delta = Self::compute_public_input_delta(
            public_inputs_bytes,
            &proof.pairing_point_object,
            t.rel_params.beta,
            t.rel_params.gamma,
            pub_inputs_offset,
            self.vk.circuit_size,
        )
        .map_err(VerifyError::InvalidInput)?;

        trace!(
            "[verifier] public_inputs_delta = 0x{}",
            hex::encode(t.rel_params.public_inputs_delta.to_bytes())
        );

        // 5) Sum-check
        if let Err(e) = verify_sumcheck(&proof, &t, &self.vk) {
             self.env.events().publish((symbol_short!("err"), symbol_short!("sumcheck")), ());
             return Err(VerifyError::SumcheckFailed(e));
        }

        // 6) Shplonk
        if let Err(e) = verify_shplemini(&self.env, &proof, &self.vk, &t) {
             self.env.events().publish((symbol_short!("err"), symbol_short!("shplonk")), ());
             return Err(VerifyError::ShplonkFailed(e));
        }

        Ok(())
    }

    fn compute_public_input_delta(
        public_inputs: &Bytes,
        pairing_point_object: &[Fr],
        beta: Fr,
        gamma: Fr,
        offset: u64,
        _n: u64,
    ) -> Result<Fr, &'static str> {
        let mut numerator = Fr::one();
        let mut denominator = Fr::one();

        /// Solidity: PERMUTATION_ARGUMENT_VALUE_SEPARATOR = 1 << 28
        const PERMUTATION_ARGUMENT_VALUE_SEPARATOR: u64 = 1 << 28;
        let mut numerator_acc = gamma + beta * Fr::from_u64(PERMUTATION_ARGUMENT_VALUE_SEPARATOR + offset);
        let mut denominator_acc = gamma - beta * Fr::from_u64(offset + 1);

        let mut idx = 0u32;
        while idx < public_inputs.len() {
            let mut arr = [0u8; 32];
            public_inputs.slice(idx..idx + 32).copy_into_slice(&mut arr);
            let public_input = Fr::from_bytes(&arr);
            numerator = numerator * (numerator_acc + public_input);
            denominator = denominator * (denominator_acc + public_input);
            numerator_acc = numerator_acc + beta;
            denominator_acc = denominator_acc - beta;
            idx += 32;
        }
        for public_input in pairing_point_object {
            numerator = numerator * (numerator_acc + *public_input);
            denominator = denominator * (denominator_acc + *public_input);
            numerator_acc = numerator_acc + beta;
            denominator_acc = denominator_acc - beta;
        }
        let denominator_inv = denominator
            .inverse()
            .ok_or("public input delta denom is zero")?;
        Ok(numerator * denominator_inv)
    }
}
