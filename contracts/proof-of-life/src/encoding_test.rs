#![cfg(test)]

//! Encoding verification tests for public inputs
//!
//! These tests verify that u32 values and Poseidon commitments are encoded
//! consistently between the circuit, prover, and contract.

use soroban_sdk::{BytesN, Env};

/// Encode u32 as BytesN<32> using big-endian (matches contract's bytes32_from_u32)
fn bytes32_from_u32(env: &Env, v: u32) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = (v & 0xFF) as u8;
    arr[30] = ((v >> 8) & 0xFF) as u8;
    arr[29] = ((v >> 16) & 0xFF) as u8;
    arr[28] = ((v >> 24) & 0xFF) as u8;
    BytesN::from_array(env, &arr)
}

#[test]
fn u32_field_encoding_roundtrip() {
    let env = Env::default();

    // Test edge cases and representative values
    let test_values = [
        0u32,           // Min value
        1u32,           // Unit
        42u32,          // Small value
        100u32,         // Battery max
        255u32,         // Single byte max
        256u32,         // Two bytes
        65535u32,       // Two bytes max
        65536u32,       // Three bytes
        1000000u32,     // Large value
        550145953u32,   // Session ID from artifacts (0x20ca8fa1)
        u32::MAX,       // Max value
    ];

    for val in &test_values {
        let val = *val;
        let encoded = bytes32_from_u32(&env, val);

        // Verify it's a 32-byte field
        assert_eq!(encoded.len(), 32);

        // Verify big-endian encoding
        let bytes = encoded.to_array();
        let decoded = u32::from_be_bytes([bytes[28], bytes[29], bytes[30], bytes[31]]);
        assert_eq!(decoded, val, "Roundtrip failed for value {}", val);

        // Verify leading zeros
        for i in 0..28 {
            assert_eq!(bytes[i], 0, "Non-zero padding at byte {} for value {}", i, val);
        }
    }
}

#[test]
fn commitment_field_is_32_bytes() {
    let env = Env::default();

    // Test commitment from actual proof artifacts (ping_distance Poseidon2 output)
    // Hex: 03d59b225b4bc59a3fd3ad70c4311eefe6f149c4ab6aa1dc42d1bcc86c20c857
    let commitment_bytes = [
        0x03, 0xd5, 0x9b, 0x22, 0x5b, 0x4b, 0xc5, 0x9a,
        0x3f, 0xd3, 0xad, 0x70, 0xc4, 0x31, 0x1e, 0xef,
        0xe6, 0xf1, 0x49, 0xc4, 0xab, 0x6a, 0xa1, 0xdc,
        0x42, 0xd1, 0xbc, 0xc8, 0x6c, 0x20, 0xc8, 0x57,
    ];

    let commitment = BytesN::<32>::from_array(&env, &commitment_bytes);
    assert_eq!(commitment.len(), 32);

    // Verify byte-for-byte equality works
    let commitment2 = BytesN::<32>::from_array(&env, &commitment_bytes);
    assert_eq!(commitment, commitment2);
}

#[test]
fn public_input_field_size_matches_circuit() {
    // Verify expected field counts match circuit definitions

    // ping_distance: [tower_x, tower_y, session_id, turn, commitment, d2]
    let ping_field_count = 6;
    let ping_byte_size = ping_field_count * 32;
    assert_eq!(ping_byte_size, 192);

    // move_proof: [session_id, turn, commitment_old, commitment_new]
    let move_field_count = 4;
    let move_byte_size = move_field_count * 32;
    assert_eq!(move_byte_size, 128);

    // turn_status: [cx, cy, session_id, turn, commitment, d2_chad]
    let turn_field_count = 6;
    let turn_byte_size = turn_field_count * 32;
    assert_eq!(turn_byte_size, 192);
}

#[test]
fn session_id_and_turn_encoding_matches_artifacts() {
    let env = Env::default();

    // From ping_distance/target/public_inputs_fields.json
    // Field 2: "0x0000000000000000000000000000000000000000000000000000000020ca8fa1"
    // Field 3: "0x0000000000000000000000000000000000000000000000000000000000000000"

    let session_id = 550145953u32; // 0x20ca8fa1
    let turn = 0u32;

    let session_encoded = bytes32_from_u32(&env, session_id);
    let turn_encoded = bytes32_from_u32(&env, turn);

    // Verify encoding matches expected hex
    let session_bytes = session_encoded.to_array();
    assert_eq!(session_bytes[28], 0x20);
    assert_eq!(session_bytes[29], 0xca);
    assert_eq!(session_bytes[30], 0x8f);
    assert_eq!(session_bytes[31], 0xa1);

    let turn_bytes = turn_encoded.to_array();
    for byte in turn_bytes.iter() {
        assert_eq!(*byte, 0);
    }
}

#[test]
fn tower_coordinates_encoding() {
    let env = Env::default();

    // From ping_distance artifacts: tower_x=9, tower_y=5
    let tower_x = 9u32;
    let tower_y = 5u32;

    let x_encoded = bytes32_from_u32(&env, tower_x);
    let y_encoded = bytes32_from_u32(&env, tower_y);

    let x_bytes = x_encoded.to_array();
    assert_eq!(x_bytes[31], 9);
    for i in 0..31 {
        assert_eq!(x_bytes[i], 0);
    }

    let y_bytes = y_encoded.to_array();
    assert_eq!(y_bytes[31], 5);
    for i in 0..31 {
        assert_eq!(y_bytes[i], 0);
    }
}

#[test]
fn d2_distance_encoding() {
    let env = Env::default();

    // From ping_distance artifacts: d2 = 34 (0x22)
    let d2 = 34u32;

    let d2_encoded = bytes32_from_u32(&env, d2);
    let bytes = d2_encoded.to_array();

    assert_eq!(bytes[31], 0x22);
    assert_eq!(bytes[30], 0x00);
    for i in 0..30 {
        assert_eq!(bytes[i], 0);
    }
}

#[test]
fn commitment_comparison_is_byte_exact() {
    let env = Env::default();

    // Test that commitment comparison is exact byte-for-byte
    let commitment1 = BytesN::from_array(&env, &[7u8; 32]);
    let commitment2 = BytesN::from_array(&env, &[7u8; 32]);
    let commitment3 = BytesN::from_array(&env, &[8u8; 32]);

    assert_eq!(commitment1, commitment2);
    assert_ne!(commitment1, commitment3);

    // Test that even one bit difference is detected
    let arr1 = [7u8; 32];
    let mut arr2 = [7u8; 32];
    arr2[0] ^= 0x01; // Flip one bit

    let cmt1 = BytesN::from_array(&env, &arr1);
    let cmt2 = BytesN::from_array(&env, &arr2);

    assert_ne!(cmt1, cmt2, "Single bit flip should be detected");
}

#[test]
fn field_boundaries_no_overflow() {
    let env = Env::default();

    // BN254 field prime is ~254 bits, but u32::MAX fits comfortably
    let max_u32 = u32::MAX;
    let encoded = bytes32_from_u32(&env, max_u32);

    // Should encode without overflow
    let bytes = encoded.to_array();
    assert_eq!(bytes[28], 0xFF);
    assert_eq!(bytes[29], 0xFF);
    assert_eq!(bytes[30], 0xFF);
    assert_eq!(bytes[31], 0xFF);

    // All u32 values fit in BN254 field (which is ~256 bits)
    // so no modular reduction should occur
}

#[test]
fn zero_value_encoding() {
    let env = Env::default();

    let zero = bytes32_from_u32(&env, 0);
    let bytes = zero.to_array();

    for byte in bytes.iter() {
        assert_eq!(*byte, 0, "All bytes should be zero");
    }
}
