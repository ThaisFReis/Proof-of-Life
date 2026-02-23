#!/usr/bin/env bash
# Build UltraHonk proof artifacts for all circuits
# Requires: nargo v1.0.0-beta.18 + bb v3.0.0-nightly.20260102
set -euo pipefail

# bbup installs `bb` in `$HOME/.bb/bb` (v3.x). Old v0.87.0 may linger in `$HOME/.bb/bin/bb`.
# Put $HOME/.bb FIRST to pick up v3.x over any legacy binary.
export PATH="$HOME/.nargo/bin:$HOME/.bb:$HOME/.bb/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CIRCUITS=("ping_distance" "turn_status" "move_proof")

for name in "${CIRCUITS[@]}"; do
  dir="circuits/$name"
  [ -d "$dir" ] || continue
  [ -f "$dir/Nargo.toml" ] || continue

  echo "► building $name"
  pushd "$dir" > /dev/null

  # Compile and execute witness
  nargo compile
  [ -f Prover.toml ] || nargo check --overwrite
  nargo execute

  json="target/${name}.json"
  gz="target/${name}.gz"

  # Remove stale vk (bb reads ./target/vk by default and fails if incompatible)
  rm -f target/vk target/proof target/public_inputs
  rm -rf target/proof-out

  # Generate UltraHonk proof + VK in one pass (output to subdir to avoid clash with compiled json)
  mkdir -p target/proof-out
  bb prove -b "$json" -w "$gz" -o target/proof-out \
    --verifier_target evm-no-zk --write_vk

  # Copy artifacts to target/ for backwards compatibility with deploy scripts
  cp target/proof-out/vk target/vk
  cp target/proof-out/proof target/proof
  cp target/proof-out/public_inputs target/public_inputs
  cp target/proof-out/vk_hash target/vk_hash

  # Generate vk_with_hash (32-byte hash + 1888-byte VK) for the verifier contract
  cat target/vk_hash target/vk > target/vk_with_hash

  echo "  ✅ $name: proof + vk + vk_with_hash generated"
  popd > /dev/null
done

echo ""
echo "🎉 All circuit artifacts ready!"
echo "Next: deploy contracts/ultrahonk-verifier with VK bytes"
