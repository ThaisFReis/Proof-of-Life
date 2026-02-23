//! Utilities for loading Proof and VerificationKey, plus byte↔field/point conversion.

use crate::field::Fr;
use crate::types::{
    G1Point, Proof, VerificationKey, BATCHED_RELATION_PARTIAL_LENGTH, CONST_PROOF_SIZE_LOG_N,
    NUMBER_OF_ENTITIES, PAIRING_POINTS_SIZE,
};
use core::array;
use soroban_sdk::Bytes;

/// Convert a 32-byte big-endian array into an Fr.
fn bytes32_to_fr(bytes: &[u8; 32]) -> Fr {
    Fr::from_bytes(bytes)
}

/// Split a 32-byte big-endian field element into (low136, high) limbs.
/// Used by the transcript to serialize G1 points in the Fiat–Shamir hash.
pub fn coord_to_halves_be(coord: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let mut low = [0u8; 32];
    let mut high = [0u8; 32];
    low[15..].copy_from_slice(&coord[15..]); // 17 bytes
    high[17..].copy_from_slice(&coord[..15]); // 15 bytes
    (low, high)
}

fn read_bytes<const N: usize>(bytes: &Bytes, idx: &mut u32) -> [u8; N] {
    let mut out = [0u8; N];
    let end = *idx + N as u32;
    bytes.slice(*idx..end).copy_into_slice(&mut out);
    *idx = end;
    out
}

/// Compute expected proof byte size for a given log_n.
///
/// bb v3.0.0 with keccak oracle hash:
///   - Pairing point object: 16 Fr
///   - 8 G1 commitments (native, 2 Fr each): 16 Fr
///   - Sumcheck univariates: log_n × 8 Fr
///   - Sumcheck evaluations: 41 Fr
///   - Gemini fold comms: (log_n-1) × 2 Fr
///   - Gemini evaluations: log_n Fr
///   - Shplonk Q + KZG quotient: 2 × 2 = 4 Fr
///   Total fields = 75 + 11×log_n
pub fn proof_bytes_for_log_n(log_n: u64) -> usize {
    (75 + 11 * log_n as usize) * 32
}

/// Load a Proof from a byte array.
///
/// bb v3.0.0 with keccak oracle hash: G1 coordinates in the proof are
/// native (x, y) — 2 fields per point. The proof size depends on
/// the circuit's log_n. Arrays are zero-padded to CONST_PROOF_SIZE_LOG_N.
pub fn load_proof(proof_bytes: &Bytes, log_n: usize) -> Proof {
    assert!(log_n <= CONST_PROOF_SIZE_LOG_N, "log_n too large");
    let expected = proof_bytes_for_log_n(log_n as u64);
    assert_eq!(proof_bytes.len() as usize, expected, "proof bytes len");
    let mut boundary = 0u32;

    fn bytes_to_g1_native(bytes: &Bytes, cur: &mut u32) -> G1Point {
        let x = read_bytes::<32>(bytes, cur);
        let y = read_bytes::<32>(bytes, cur);
        G1Point { x, y }
    }

    fn bytes_to_fr(bytes: &Bytes, cur: &mut u32) -> Fr {
        let arr = read_bytes::<32>(bytes, cur);
        bytes32_to_fr(&arr)
    }

    // 0) pairing point object
    let pairing_point_object: [Fr; PAIRING_POINTS_SIZE] =
        array::from_fn(|_| bytes_to_fr(proof_bytes, &mut boundary));

    // 1) w1, w2, w3
    let w1 = bytes_to_g1_native(proof_bytes, &mut boundary);
    let w2 = bytes_to_g1_native(proof_bytes, &mut boundary);
    let w3 = bytes_to_g1_native(proof_bytes, &mut boundary);

    // 2) lookup_read_counts, lookup_read_tags
    let lookup_read_counts = bytes_to_g1_native(proof_bytes, &mut boundary);
    let lookup_read_tags = bytes_to_g1_native(proof_bytes, &mut boundary);

    // 3) w4
    let w4 = bytes_to_g1_native(proof_bytes, &mut boundary);

    // 4) lookup_inverses, z_perm
    let lookup_inverses = bytes_to_g1_native(proof_bytes, &mut boundary);
    let z_perm = bytes_to_g1_native(proof_bytes, &mut boundary);

    // 5) sumcheck_univariates — only log_n rounds present, rest zero
    let mut sumcheck_univariates =
        [[Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH]; CONST_PROOF_SIZE_LOG_N];
    for r in 0..log_n {
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            sumcheck_univariates[r][i] = bytes_to_fr(proof_bytes, &mut boundary);
        }
    }

    // 6) sumcheck_evaluations
    let sumcheck_evaluations: [Fr; NUMBER_OF_ENTITIES] =
        array::from_fn(|_| bytes_to_fr(proof_bytes, &mut boundary));

    // 7) gemini_fold_comms — only (log_n - 1) present, rest infinity
    let mut gemini_fold_comms = [G1Point::infinity(); CONST_PROOF_SIZE_LOG_N - 1];
    for i in 0..(log_n - 1) {
        gemini_fold_comms[i] = bytes_to_g1_native(proof_bytes, &mut boundary);
    }

    // 8) gemini_a_evaluations — only log_n present, rest zero
    let mut gemini_a_evaluations = [Fr::zero(); CONST_PROOF_SIZE_LOG_N];
    for i in 0..log_n {
        gemini_a_evaluations[i] = bytes_to_fr(proof_bytes, &mut boundary);
    }

    // 9) shplonk_q, kzg_quotient
    let shplonk_q = bytes_to_g1_native(proof_bytes, &mut boundary);
    let kzg_quotient = bytes_to_g1_native(proof_bytes, &mut boundary);

    Proof {
        pairing_point_object,
        w1,
        w2,
        w3,
        w4,
        lookup_read_counts,
        lookup_read_tags,
        lookup_inverses,
        z_perm,
        sumcheck_univariates,
        sumcheck_evaluations,
        gemini_fold_comms,
        gemini_a_evaluations,
        shplonk_q,
        kzg_quotient,
    }
}

/// Load a VerificationKey from bb v3.0.0 binary format.
///
/// bb v3.0.0 VK format:
///   Header:  3 × 32 bytes = 96 bytes (log_circuit_size, num_public_inputs, pub_inputs_offset)
///   Points: 28 × 64 bytes = 1792 bytes (native G1 coordinates)
///   Total: 1888 bytes (keccak oracle) or 3680 bytes (poseidon2 oracle, with zero padding)
pub fn load_vk_from_bytes(bytes: &Bytes) -> Option<VerificationKey> {
    const MIN_LEN: usize = 96 + 28 * 64; // 1888 bytes
    let len = bytes.len() as usize;
    if len != MIN_LEN && len != MIN_LEN + 28 * 64 {
        return None;
    }

    fn read_u64_from_field(bytes: &Bytes, idx: &mut u32) -> u64 {
        // Read 32 byte field, take last 8 bytes (Big Endian)
        let _padding = read_bytes::<24>(bytes, idx);
        u64::from_be_bytes(read_bytes::<8>(bytes, idx))
    }

    fn read_point(bytes: &Bytes, idx: &mut u32) -> Option<G1Point> {
        let x = read_bytes::<32>(bytes, idx);
        let y = read_bytes::<32>(bytes, idx);
        Some(G1Point { x, y })
    }

    let mut idx = 0u32;
    // bb v3.0.0: 3 header fields
    let log_circuit_size = read_u64_from_field(bytes, &mut idx);
    let public_inputs_size = read_u64_from_field(bytes, &mut idx);
    let pub_inputs_offset = read_u64_from_field(bytes, &mut idx);

    let circuit_size = 1u64 << log_circuit_size;

    // 28 G1 points in order: qm, qc, ql, qr, qo, q4, qLookup, qArith,
    // qDeltaRange, qElliptic, qMemory, qNnf, qPoseidon2External, qPoseidon2Internal,
    // s1-s4, id1-id4, t1-t4, lagrangeFirst, lagrangeLast
    let qm = read_point(bytes, &mut idx)?;
    let qc = read_point(bytes, &mut idx)?;
    let ql = read_point(bytes, &mut idx)?;
    let qr = read_point(bytes, &mut idx)?;
    let qo = read_point(bytes, &mut idx)?;
    let q4 = read_point(bytes, &mut idx)?;
    let q_lookup = read_point(bytes, &mut idx)?;
    let q_arith = read_point(bytes, &mut idx)?;
    let q_delta_range = read_point(bytes, &mut idx)?;
    let q_elliptic = read_point(bytes, &mut idx)?;
    let q_memory = read_point(bytes, &mut idx)?;
    let q_nnf = read_point(bytes, &mut idx)?;
    let q_poseidon2_external = read_point(bytes, &mut idx)?;
    let q_poseidon2_internal = read_point(bytes, &mut idx)?;
    let s1 = read_point(bytes, &mut idx)?;
    let s2 = read_point(bytes, &mut idx)?;
    let s3 = read_point(bytes, &mut idx)?;
    let s4 = read_point(bytes, &mut idx)?;
    let id1 = read_point(bytes, &mut idx)?;
    let id2 = read_point(bytes, &mut idx)?;
    let id3 = read_point(bytes, &mut idx)?;
    let id4 = read_point(bytes, &mut idx)?;
    let t1 = read_point(bytes, &mut idx)?;
    let t2 = read_point(bytes, &mut idx)?;
    let t3 = read_point(bytes, &mut idx)?;
    let t4 = read_point(bytes, &mut idx)?;
    let lagrange_first = read_point(bytes, &mut idx)?;
    let lagrange_last = read_point(bytes, &mut idx)?;

    Some(VerificationKey {
        circuit_size,
        log_circuit_size,
        public_inputs_size,
        pub_inputs_offset,
        qm,
        qc,
        ql,
        qr,
        qo,
        q4,
        q_lookup,
        q_arith,
        q_delta_range,
        q_elliptic,
        q_memory,
        q_nnf,
        q_poseidon2_external,
        q_poseidon2_internal,
        s1,
        s2,
        s3,
        s4,
        id1,
        id2,
        id3,
        id4,
        t1,
        t2,
        t3,
        t4,
        lagrange_first,
        lagrange_last,
    })
}
