// Proof of Life - move_proof
//
// Proves that an assassin moved from (x_old, y_old) to (x_new, y_new)
// with a Manhattan distance of exactly 1, without revealing either coordinate.
//
// Phase 5: Added session_id and turn for anti-replay protection
// Public input order (v3): (session_id, turn)
// Public outputs: [commitment_old, commitment_new]

/// Poseidon2 hash over 3 field elements (sponge: absorb into t=4 state, squeeze first element).
fn poseidon2_hash_3(inputs: [Field; 3]) -> Field {
    std::hash::poseidon2_permutation([inputs[0], inputs[1], inputs[2], 0], 4)[0]
}

fn abs_diff(a: Field, b: Field) -> Field {
    if a.lt(b) { b - a } else { a - b }
}

fn main(
    x_old: Field,
    y_old: Field,
    salt_old: Field,
    x_new: Field,
    y_new: Field,
    salt_new: Field,
    session_id: pub Field,  // NEW: Binds proof to specific session
    turn: pub Field,        // NEW: Binds proof to specific turn
) -> pub [Field; 2] {
    // Commitments (Poseidon2 over BN254).
    let commitment_old = poseidon2_hash_3([x_old, y_old, salt_old]);
    let commitment_new = poseidon2_hash_3([x_new, y_new, salt_new]);

    // Range checks for the MVP grid (10x10).
    // assert(x_old.lt(10));
    // assert(y_old.lt(10));
    // assert(x_new.lt(10));
    // assert(y_new.lt(10));

    // The session_id and turn are passed through as public inputs
    // for the contract to verify. No additional circuit logic needed.

    // Move logic: Manhattan distance must be exactly 1.
    let dx = abs_diff(x_old, x_new);
    let dy = abs_diff(y_old, y_new);
    assert(dx + dy == 1);

    [commitment_old, commitment_new]
}
