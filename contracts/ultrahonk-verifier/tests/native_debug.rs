use soroban_sdk::{Bytes, Env};
use ultrahonk_soroban_verifier::UltraHonkVerifier;
use ultrahonk_soroban_verifier::transcript::generate_transcript;
use ultrahonk_soroban_verifier::utils::{load_proof, load_vk_from_bytes};
use ultrahonk_soroban_verifier::types::PAIRING_POINTS_SIZE;
use ultrahonk_soroban_verifier::field::Fr;
use ultrahonk_soroban_verifier::sumcheck::verify_sumcheck;
use ultrahonk_soroban_verifier::relations::accumulate_relation_evaluations;

#[test]
fn native_debug_simple_circuit() {
    // vk_with_hash = 32-byte vk_hash + 1888-byte VK binary
    let vk_bytes_raw: &[u8] = include_bytes!("simple_circuit/target/vk_with_hash");
    let proof_bin: &[u8] = include_bytes!("simple_circuit/target/proof");
    let pub_inputs_bin: &[u8] = include_bytes!("simple_circuit/target/public_inputs");

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    let vk_bytes = Bytes::from_slice(&env, vk_bytes_raw);
    let proof_bytes = Bytes::from_slice(&env, proof_bin);
    let public_inputs = Bytes::from_slice(&env, pub_inputs_bin);

    // Extract vk_hash
    let mut vk_hash = [0u8; 32];
    vk_hash.copy_from_slice(&vk_bytes_raw[..32]);
    println!("VK hash: 0x{}", hex::encode(vk_hash));

    // Parse VK from the remaining bytes
    let vk_data = Bytes::from_slice(&env, &vk_bytes_raw[32..]);
    let vk = load_vk_from_bytes(&vk_data).expect("VK parse failed");
    let log_n = vk.log_circuit_size as usize;
    let proof = load_proof(&proof_bytes, log_n);

    println!("circuit_size={}, log_n={}, public_inputs_size={}, pub_inputs_offset={}",
        vk.circuit_size, log_n, vk.public_inputs_size, vk.pub_inputs_offset);

    // Compute transcript
    let provided = (public_inputs.len() / 32) as u64;
    let pis_total = provided + PAIRING_POINTS_SIZE as u64;
    println!("provided={}, pis_total={}", provided, pis_total);

    let mut t = generate_transcript(
        &env, &proof, &public_inputs, &vk_hash,
        vk.circuit_size, pis_total, vk.pub_inputs_offset,
    );

    println!("\n=== Transcript Challenges ===");
    println!("eta:       0x{}", hex::encode(t.rel_params.eta.to_bytes()));
    println!("eta_two:   0x{}", hex::encode(t.rel_params.eta_two.to_bytes()));
    println!("eta_three: 0x{}", hex::encode(t.rel_params.eta_three.to_bytes()));
    println!("beta:      0x{}", hex::encode(t.rel_params.beta.to_bytes()));
    println!("gamma:     0x{}", hex::encode(t.rel_params.gamma.to_bytes()));
    println!("alpha[0]:  0x{}", hex::encode(t.alphas[0].to_bytes()));
    println!("alpha[1]:  0x{}", hex::encode(t.alphas[1].to_bytes()));
    println!("gate[0]:   0x{}", hex::encode(t.gate_challenges[0].to_bytes()));
    println!("gate[1]:   0x{}", hex::encode(t.gate_challenges[1].to_bytes()));
    for i in 0..log_n {
        println!("sumcheck_u[{}]: 0x{}", i, hex::encode(t.sumcheck_u_challenges[i].to_bytes()));
    }

    // Compute public_inputs_delta
    let pi_delta = compute_public_input_delta_debug(
        &public_inputs, &proof.pairing_point_object,
        t.rel_params.beta, t.rel_params.gamma,
        vk.pub_inputs_offset, vk.circuit_size,
    );
    t.rel_params.public_inputs_delta = pi_delta;
    println!("\npublic_inputs_delta: 0x{}", hex::encode(pi_delta.to_bytes()));

    // Run sumcheck
    println!("\n=== Sumcheck Verification ===");
    let mut round_target = Fr::zero();
    let mut pow_partial = Fr::one();
    for round in 0..log_n {
        let u = &proof.sumcheck_univariates[round];
        let sum = u[0] + u[1];
        let ok = sum == round_target;
        println!("Round {}: sum=0x{} target=0x{} ok={}",
            round,
            hex::encode(sum.to_bytes()),
            hex::encode(round_target.to_bytes()),
            ok,
        );

        let rc = t.sumcheck_u_challenges[round];
        // Barycentric eval would go here but let's just check the final
        pow_partial = pow_partial * (Fr::one() + rc * (t.gate_challenges[round] - Fr::one()));
    }

    // Final relation check
    let grand = accumulate_relation_evaluations(
        &proof.sumcheck_evaluations,
        &t.rel_params,
        &t.alphas,
        pow_partial,
    );

    // We need to compute the last round_target properly
    match verify_sumcheck(&proof, &t, &vk) {
        Ok(()) => println!("\n✅ Sumcheck PASSED!"),
        Err(e) => println!("\n❌ Sumcheck FAILED: {}", e),
    }

    // Full verification
    let verifier = UltraHonkVerifier::new(&env, &vk_bytes).expect("VK parse");
    match verifier.verify(&proof_bytes, &public_inputs) {
        Ok(()) => println!("✅ Full verification PASSED!"),
        Err(e) => println!("❌ Full verification FAILED: {:?}", e),
    }
}

fn compute_public_input_delta_debug(
    public_inputs: &Bytes,
    pairing_point_object: &[Fr],
    beta: Fr, gamma: Fr,
    offset: u64, n: u64,
) -> Fr {
    let mut numerator = Fr::one();
    let mut denominator = Fr::one();
    let mut numerator_acc = gamma + beta * Fr::from_u64(n + offset);
    let mut denominator_acc = gamma - beta * Fr::from_u64(offset + 1);
    let mut idx = 0u32;
    while idx < public_inputs.len() {
        let mut arr = [0u8; 32];
        public_inputs.slice(idx..idx + 32).copy_into_slice(&mut arr);
        let pi = Fr::from_bytes(&arr);
        numerator = numerator * (numerator_acc + pi);
        denominator = denominator * (denominator_acc + pi);
        numerator_acc = numerator_acc + beta;
        denominator_acc = denominator_acc - beta;
        idx += 32;
    }
    for pi in pairing_point_object {
        numerator = numerator * (numerator_acc + *pi);
        denominator = denominator * (denominator_acc + *pi);
        numerator_acc = numerator_acc + beta;
        denominator_acc = denominator_acc - beta;
    }
    numerator * denominator.inverse().expect("denom zero")
}
