// Proof of Life - turn_status
//
// Returns a public commitment for a secret assassin coordinate (x,y,salt),
// and returns the squared Euclidean distance to the public Chad coordinate.
//
// Phase 5: Added session_id and turn for anti-replay protection.
// Public input order (v3): (cx, cy, session_id, turn)
// Public outputs: [commitment, d2_chad]

/// Poseidon2 hash over 3 field elements (sponge: absorb into t=4 state, squeeze first element).
fn poseidon2_hash_3(inputs: [Field; 3]) -> Field {
    std::hash::poseidon2_permutation([inputs[0], inputs[1], inputs[2], 0], 4)[0]
}

fn main(
    x: Field,
    y: Field,
    salt: Field,
    cx: pub Field,
    cy: pub Field,
    session_id: pub Field,  // NEW: Binds proof to specific session
    turn: pub Field,        // NEW: Binds proof to specific turn
) -> pub [Field; 2] {
    // Commitment (Poseidon2 over BN254).
    let commitment = poseidon2_hash_3([x, y, salt]);

    // assert(x.lt(10));
    // assert(y.lt(10));

    // The session_id and turn are passed through as public inputs
    // for the contract to verify. No additional circuit logic needed.

    let dx = x - cx;
    let dy = y - cy;
    let d2_chad = (dx * dx) + (dy * dy);
    [commitment, d2_chad]
}
