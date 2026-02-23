// Proof of Life - ping_distance
//
// Returns a public commitment for a secret assassin coordinate (x,y,salt),
// and returns the squared Euclidean distance to a public tower coordinate.
//
// Phase 5: Added session_id and turn for anti-replay protection
// Public input order (v3): (tower_x, tower_y, session_id, turn)
// Public outputs: [commitment, d2]

/// Poseidon2 hash over 3 field elements (sponge: absorb into t=4 state, squeeze first element).
fn poseidon2_hash_3(inputs: [Field; 3]) -> Field {
    std::hash::poseidon2_permutation([inputs[0], inputs[1], inputs[2], 0], 4)[0]
}

fn main(
    x: Field,
    y: Field,
    salt: Field,
    tower_x: pub Field,
    tower_y: pub Field,
    session_id: pub Field,  // NEW: Binds proof to specific session
    turn: pub Field,        // NEW: Binds proof to specific turn
) -> pub [Field; 2] {
    // Commitment (Poseidon2 over BN254).
    let commitment = poseidon2_hash_3([x, y, salt]);

    // Range checks for the MVP grid (10x10).
    // assert(x.lt(10));
    // assert(y.lt(10));

    // The session_id and turn are passed through as public inputs
    // for the contract to verify. No additional circuit logic needed.

    let dx = x - tower_x;
    let dy = y - tower_y;
    let d2 = (dx * dx) + (dy * dy);
    [commitment, d2]
}

#[test]
fn test_ping_distance() {
    let x: Field = 3;
    let y: Field = 4;
    let salt: Field = 12345;
    let tower_x: Field = 5;
    let tower_y: Field = 5;
    let session_id: Field = 1;
    let turn: Field = 0;

    let out = main(x, y, salt, tower_x, tower_y, session_id, turn);
    let commitment = out[0];
    let d2 = out[1];
    assert(commitment == poseidon2_hash_3([x, y, salt]));
    // dx=3-5=-2, dy=4-5=-1 -> d2 = 4+1 = 5
    assert(d2 == 5);
}
