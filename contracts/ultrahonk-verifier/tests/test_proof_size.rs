use ultrahonk_soroban_verifier::proof_bytes_for_log_n;
use ultrahonk_soroban_verifier::types::*;

#[test]
fn test_proof_size_formula() {
    // For log_n = 6 (simple_circuit, 2^6 = 64 gates)
    let log_n: u64 = 6;
    let expected = proof_bytes_for_log_n(log_n);

    // Calculate manually
    let mut fields: usize = 0;

    // 0) pairing point object (16 fields)
    fields += PAIRING_POINTS_SIZE;

    // 1-4) 8 G1 commitments (native, 2 fields each)
    fields += 8 * 2;

    // 5) sumcheck_univariates (log_n rounds × BATCHED_RELATION_PARTIAL_LENGTH)
    fields += log_n as usize * BATCHED_RELATION_PARTIAL_LENGTH;

    // 6) sumcheck_evaluations
    fields += NUMBER_OF_ENTITIES;

    // 7) gemini_fold_comms (log_n - 1 native G1 points)
    fields += (log_n as usize - 1) * 2;

    // 8) gemini_a_evaluations
    fields += log_n as usize;

    // 9) shplonk_q, kzg_quotient (2 native G1 points)
    fields += 2 * 2;

    assert_eq!(
        fields * 32,
        expected,
        "proof_bytes_for_log_n({}) mismatch: formula={} manual={}",
        log_n,
        expected,
        fields * 32
    );

    // Formula: 75 + 11*log_n
    assert_eq!(fields, 75 + 11 * log_n as usize);

    // Verify against actual proof file size
    let proof_bin: &[u8] = include_bytes!("simple_circuit/target/proof");
    assert_eq!(
        proof_bin.len(),
        expected,
        "proof file size mismatch: file={} formula={}",
        proof_bin.len(),
        expected
    );
}
