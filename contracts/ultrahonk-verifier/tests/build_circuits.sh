#!/usr/bin/env bash
set -euo pipefail

NOIR_VERSION="1.0.0-beta.18"
BB_VERSION="v3.0.0-nightly.20260102"

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

install_nargo() {
  if ! command -v nargo >/dev/null 2>&1; then
    echo "• installing nargo $NOIR_VERSION"
    curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | \
      NOIR_VERSION="$NOIR_VERSION" bash
    export PATH="$HOME/.nargo/bin:$PATH"
    [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.nargo/bin" >> "$GITHUB_PATH"

    noirup -v "$NOIR_VERSION"
  fi
}

install_bb() {
  if command -v bb >/dev/null 2>&1; then return; fi

  echo "• installing bb $BB_VERSION"
  curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
  bbup -nv
  export PATH="$HOME/.bb:$PATH"
  [ -n "${GITHUB_PATH:-}" ] && echo "$HOME/.bb" >> "$GITHUB_PATH"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

install_nargo
install_bb

for dir in tests/* ; do
  [ -d "$dir" ] || continue
  [ -f "$dir/Nargo.toml" ] || continue

  name=$(basename "$dir")
  echo "► building $name"
  pushd "$dir" >/dev/null

  [ -f Prover.toml ] || nargo check --overwrite
  nargo execute

  json="target/${name}.json"
  gz="target/${name}.gz"

  # bb v3.0.0: use keccak oracle hash (matches Soroban transcript), --disable_zk for non-ZK proofs
  bb write_vk -b "$json" -o target \
    --scheme ultra_honk --oracle_hash keccak

  # Flatten VK directory if bb outputs target/vk/vk
  if [[ -d target/vk && -f target/vk/vk ]]; then
    mv target/vk/vk target/vk.tmp
    rmdir target/vk
    mv target/vk.tmp target/vk
  fi

  bb prove -b "$json" -w "$gz" -o target \
    --scheme ultra_honk --oracle_hash keccak --disable_zk

  popd >/dev/null
done
