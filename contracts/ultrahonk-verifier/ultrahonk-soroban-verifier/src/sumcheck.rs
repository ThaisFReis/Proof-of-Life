//! Sum-check verifier
use crate::{
    field::Fr,
    relations::accumulate_relation_evaluations,
    trace,
    types::{Transcript, VerificationKey, BATCHED_RELATION_PARTIAL_LENGTH},
};

/// Barycentric Lagrange denominators for evaluation points {0, 1, ..., 7}.
/// d_i = ∏_{j≠i} (i - j) as BN254 scalar field elements.
const BARY_BYTES: [[u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH] = [
    // d_0 = -5040 (p - 5040)
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
        0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
        0xef, 0xff, 0xec, 0x51,
    ],
    // d_1 = 720
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x02, 0xd0,
    ],
    // d_2 = -240 (p - 240)
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
        0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
        0xef, 0xff, 0xff, 0x11,
    ],
    // d_3 = 144
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x90,
    ],
    // d_4 = -144 (p - 144)
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
        0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
        0xef, 0xff, 0xff, 0x71,
    ],
    // d_5 = 240
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0xf0,
    ],
    // d_6 = -720 (p - 720)
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
        0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
        0xef, 0xff, 0xfd, 0x31,
    ],
    // d_7 = 5040
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x13, 0xb0,
    ],
];

/// Check if the sum of two univariates equals the target value
#[inline(always)]
fn check_sum(round_univariate: &[Fr], round_target: Fr) -> bool {
    let total_sum = round_univariate[0] + round_univariate[1];
    total_sum == round_target
}

/// Calculate next target value for the sum-check.
///
/// Uses Montgomery's batch-inversion trick: instead of 8 individual field
/// inversions we compute the product of all denominators, invert once, then
/// unwind to recover each individual inverse.  This saves ~7 expensive modular
/// inversions per round (196 inversions saved across 28 rounds).
#[inline(always)]
fn compute_next_target_sum(
    round_univariate: &[Fr],
    round_challenge: Fr,
) -> Result<Fr, &'static str> {
    // B(χ) = ∏ (χ - i)
    let mut b_poly = Fr::one();
    let mut chi_minus = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
    for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
        chi_minus[i] = round_challenge - Fr::from_u64(i as u64);
        b_poly = b_poly * chi_minus[i];
    }

    // Compute all denominators: denom[i] = BARY[i] * (χ - i)
    let mut denoms = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
    for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
        denoms[i] = Fr::from_bytes(&BARY_BYTES[i]) * chi_minus[i];
    }

    // Montgomery's batch inversion:
    // 1) Forward pass: prefix[i] = denom[0] * denom[1] * ... * denom[i]
    let mut prefix = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
    prefix[0] = denoms[0];
    for i in 1..BATCHED_RELATION_PARTIAL_LENGTH {
        prefix[i] = prefix[i - 1] * denoms[i];
    }

    // 2) Single inversion of the full product
    let mut inv_acc = prefix[BATCHED_RELATION_PARTIAL_LENGTH - 1]
        .inverse()
        .ok_or("denom zero")?;

    // 3) Backward pass: recover individual inverses
    let mut inv = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
    for i in (1..BATCHED_RELATION_PARTIAL_LENGTH).rev() {
        inv[i] = inv_acc * prefix[i - 1];
        inv_acc = inv_acc * denoms[i];
    }
    inv[0] = inv_acc;

    // Σ u_i / (BARY[i] * (χ - i))
    let mut acc = Fr::zero();
    for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
        acc = acc + (round_univariate[i] * inv[i]);
    }

    Ok(b_poly * acc)
}

#[inline(always)]
fn partially_evaluate_pow(
    gate_challenge: Fr,
    pow_partial_evaluation: Fr,
    round_challenge: Fr,
) -> Fr {
    pow_partial_evaluation * (Fr::one() + round_challenge * (gate_challenge - Fr::one()))
}

pub fn verify_sumcheck(
    proof: &crate::types::Proof,
    tp: &Transcript,
    vk: &VerificationKey,
) -> Result<(), &'static str> {
    let log_n = vk.log_circuit_size as usize;
    let mut round_target = Fr::zero();
    let mut pow_partial_evaluation = Fr::one();

    // 1) Each round sum check and next target/pow calculation
    for round in 0..log_n {
        let round_univariate = &proof.sumcheck_univariates[round];

        trace!(
            "[sumcheck] round {}: target = 0x{}, u[0]+u[1] = 0x{}",
            round,
            hex::encode(round_target.to_bytes()),
            hex::encode((round_univariate[0] + round_univariate[1]).to_bytes())
        );

        if !check_sum(round_univariate, round_target) {
            trace!(
                "[sumcheck] FAIL at round {}: u[0] = 0x{}, u[1] = 0x{}",
                round,
                hex::encode(round_univariate[0].to_bytes()),
                hex::encode(round_univariate[1].to_bytes())
            );
            return Err("round failed");
        }

        let round_challenge = tp.sumcheck_u_challenges[round];
        round_target = compute_next_target_sum(round_univariate, round_challenge)?;
        pow_partial_evaluation = partially_evaluate_pow(
            tp.gate_challenges[round],
            pow_partial_evaluation,
            round_challenge,
        );
        trace!(
            "[sumcheck] round {} done: next_target = 0x{}, pow = 0x{}",
            round,
            hex::encode(round_target.to_bytes()),
            hex::encode(pow_partial_evaluation.to_bytes())
        );
    }

    // 2) Final relation summation
    let grand_honk_relation_sum = accumulate_relation_evaluations(
        &proof.sumcheck_evaluations,
        &tp.rel_params,
        &tp.alphas,
        pow_partial_evaluation,
    );

    if grand_honk_relation_sum == round_target {
        Ok(())
    } else {
        crate::trace!("===== SUMCHECK FINAL CHECK FAILED =====");
        crate::trace!(
            "grand_relation = 0x{}",
            hex::encode(grand_honk_relation_sum.to_bytes())
        );
        crate::trace!("target = 0x{}", hex::encode(round_target.to_bytes()));
        crate::trace!(
            "difference = 0x{}",
            hex::encode((grand_honk_relation_sum - round_target).to_bytes())
        );
        crate::trace!("======================================");
        Err("sumcheck final mismatch")
    }
}
