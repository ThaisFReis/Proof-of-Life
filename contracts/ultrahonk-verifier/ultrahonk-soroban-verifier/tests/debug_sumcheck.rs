//! Debug test harness for UltraHonk sumcheck verification.
//!
//! Loads proof artifacts from the ping_distance circuit and runs the verifier
//! with full trace output. Use `cargo test --features "std,trace" -- --nocapture debug_` to see all
//! intermediate Fiat-Shamir challenge values.

use soroban_sdk::{testutils::Ledger, Bytes, Env};
use std::{fs, path::Path};
use ultrahonk_soroban_verifier::UltraHonkVerifier;

/// Find the latest prover-out subdirectory for a circuit.
fn latest_prover_out(circuit_dir: &Path) -> Option<std::path::PathBuf> {
    let prover_out = circuit_dir.join("target/prover-out");
    if !prover_out.exists() {
        return None;
    }
    let mut entries: Vec<_> = fs::read_dir(&prover_out)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    entries.last().map(|e| e.path())
}

/// Load proof artifacts and run the verifier, returning Ok(()) or the error string.
fn run_with_artifacts(artifact_dir: &Path) -> Result<(), String> {
    let env = Env::default();
    env.ledger().set_protocol_version(25);

    // Load files
    let proof_bytes = fs::read(artifact_dir.join("proof"))
        .map_err(|e| format!("read proof: {e}"))?;
    let vk_bytes = fs::read(artifact_dir.join("vk"))
        .map_err(|e| format!("read vk: {e}"))?;
    let vk_hash_bytes = fs::read(artifact_dir.join("vk_hash"))
        .map_err(|e| format!("read vk_hash: {e}"))?;
    let pi_bytes = fs::read(artifact_dir.join("public_inputs"))
        .map_err(|e| format!("read public_inputs: {e}"))?;

    println!("=== Artifact Sizes ===");
    println!("  proof:          {} bytes", proof_bytes.len());
    println!("  vk:             {} bytes", vk_bytes.len());
    println!("  vk_hash:        {} bytes", vk_hash_bytes.len());
    println!("  public_inputs:  {} bytes ({} fields)", pi_bytes.len(), pi_bytes.len() / 32);
    println!();

    // Print VK hash
    println!("  vk_hash = 0x{}", hex::encode(&vk_hash_bytes));

    // Print first few public inputs
    for i in 0..(pi_bytes.len() / 32).min(10) {
        let offset = i * 32;
        println!(
            "  pi[{}] = 0x{}",
            i,
            hex::encode(&pi_bytes[offset..offset + 32])
        );
    }
    println!();

    // Combine vk_hash + vk → vk_with_hash
    let mut vk_combined = Vec::with_capacity(32 + vk_bytes.len());
    vk_combined.extend_from_slice(&vk_hash_bytes);
    vk_combined.extend_from_slice(&vk_bytes);

    let proof = Bytes::from_slice(&env, &proof_bytes);
    let vk = Bytes::from_slice(&env, &vk_combined);
    let pi = Bytes::from_slice(&env, &pi_bytes);

    let verifier = UltraHonkVerifier::new(&env, &vk).map_err(|e| format!("{e:?}"))?;

    // Print parsed VK metadata
    let parsed_vk = verifier.get_vk();
    println!("=== Parsed VK ===");
    println!("  circuit_size:      {}", parsed_vk.circuit_size);
    println!("  log_circuit_size:  {}", parsed_vk.log_circuit_size);
    println!("  public_inputs_size: {}", parsed_vk.public_inputs_size);
    println!("  pub_inputs_offset: {}", parsed_vk.pub_inputs_offset);
    println!();

    // Run verify
    println!("=== Running Verification ===");
    match verifier.verify(&proof, &pi) {
        Ok(()) => {
            println!("  ✅ VERIFICATION PASSED");
            Ok(())
        }
        Err(e) => {
            println!("  ❌ VERIFICATION FAILED: {e:?}");
            Err(format!("{e:?}"))
        }
    }
}

/// Locate the repo root (the directory containing 'circuits/')
fn repo_root() -> std::path::PathBuf {
    // Tests run from the crate root (ultrahonk-soroban-verifier/)
    // The repo root is 3 levels up: ../../../ (contracts/ultrahonk-verifier/ultrahonk-soroban-verifier)
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    crate_root
        .parent() // ultrahonk-verifier
        .and_then(|p| p.parent()) // contracts
        .and_then(|p| p.parent()) // repo root
        .expect("cannot find repo root")
        .to_path_buf()
}

#[test]
fn debug_ping_distance_latest() {
    let root = repo_root();
    let circuit_dir = root.join("circuits/ping_distance");

    if let Some(latest) = latest_prover_out(&circuit_dir) {
        println!("Using artifacts from: {}", latest.display());
        match run_with_artifacts(&latest) {
            Ok(()) => {}
            Err(e) => panic!("Verification failed: {e}"),
        }
    } else {
        // Fall back to target/ (build_ultrahonk.sh copies artifacts there)
        let target_dir = circuit_dir.join("target");
        if target_dir.join("proof").exists() && target_dir.join("vk").exists() {
            println!("Using artifacts from: {}", target_dir.display());
            match run_with_artifacts(&target_dir) {
                Ok(()) => {}
                Err(e) => panic!("Verification failed: {e}"),
            }
        } else {
            eprintln!("⚠ No ping_distance proof artifacts found. Run build_ultrahonk.sh first.");
            eprintln!("  Expected at: {}", circuit_dir.join("target/prover-out/").display());
        }
    }
}

#[test]
fn debug_turn_status_latest() {
    let root = repo_root();
    let circuit_dir = root.join("circuits/turn_status");

    if let Some(latest) = latest_prover_out(&circuit_dir) {
        println!("Using artifacts from: {}", latest.display());
        match run_with_artifacts(&latest) {
            Ok(()) => {}
            Err(e) => panic!("Verification failed: {e}"),
        }
    } else {
        let target_dir = circuit_dir.join("target");
        if target_dir.join("proof").exists() && target_dir.join("vk").exists() {
            println!("Using artifacts from: {}", target_dir.display());
            match run_with_artifacts(&target_dir) {
                Ok(()) => {}
                Err(e) => panic!("Verification failed: {e}"),
            }
        } else {
            eprintln!("⚠ No turn_status proof artifacts found.");
        }
    }
}

#[test]
fn debug_move_proof_latest() {
    let root = repo_root();
    let circuit_dir = root.join("circuits/move_proof");

    if let Some(latest) = latest_prover_out(&circuit_dir) {
        println!("Using artifacts from: {}", latest.display());
        match run_with_artifacts(&latest) {
            Ok(()) => {}
            Err(e) => panic!("Verification failed: {e}"),
        }
    } else {
        let target_dir = circuit_dir.join("target");
        if target_dir.join("proof").exists() && target_dir.join("vk").exists() {
            println!("Using artifacts from: {}", target_dir.display());
            match run_with_artifacts(&target_dir) {
                Ok(()) => {}
                Err(e) => panic!("Verification failed: {e}"),
            }
        } else {
            eprintln!("⚠ No move_proof proof artifacts found.");
        }
    }
}

/// Test with the simple_circuit fixtures (known-good baseline) using the
/// same artifact loading path as our game circuit tests.
#[test]
fn debug_simple_circuit_baseline() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let artifact_dir = crate_root.join("circuits/simple_circuit/target");
    if !artifact_dir.join("proof").exists() {
        eprintln!("⚠ simple_circuit fixtures not found at: {}", artifact_dir.display());
        return;
    }
    println!("Using artifacts from: {}", artifact_dir.display());
    run_with_artifacts(&artifact_dir).expect("simple_circuit should verify");
}
