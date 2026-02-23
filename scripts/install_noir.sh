#!/usr/bin/env bash
# Install Noir toolchain for ZK circuit compilation
# Usage: ./scripts/install_noir.sh

set -e

echo "🔧 Installing Noir toolchain..."

# NOTE:
# This repo's current UltraHonk pipeline is pinned to:
# - nargo/noirc 1.0.0-beta.9
# - bb 0.87.0
# Newer nargo versions can generate witnesses incompatible with bb 0.87.0.
NARGO_VERSION="${NARGO_VERSION:-1.0.0-beta.9}"

# Check if noirup is already installed
if command -v noirup &> /dev/null; then
    echo "✅ noirup already installed"
else
    echo "📥 Installing noirup..."
    curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
    
    # Add to PATH for current session
    export PATH="$HOME/.nargo/bin:$PATH"
fi

# Install/update nargo
echo "📥 Installing nargo (${NARGO_VERSION})..."
noirup --version "$NARGO_VERSION"

# Verify installation
if command -v nargo &> /dev/null; then
    echo "✅ Noir installed successfully!"
    nargo --version
else
    echo "❌ Installation failed. Please add ~/.nargo/bin to your PATH:"
    echo "   export PATH=\"\$HOME/.nargo/bin:\$PATH\""
    exit 1
fi

if ! nargo --version | grep -q "nargo version = ${NARGO_VERSION}"; then
    echo "❌ nargo version mismatch; expected ${NARGO_VERSION}"
    echo "Run manually: noirup --version ${NARGO_VERSION}"
    exit 1
fi

echo ""
echo "🎉 Noir toolchain ready!"
echo "Next steps:"
echo "  0. Ensure bb is 0.87.0: bb --version"
echo "  1. Run: bun run zk:build"
echo "  2. Circuits will be compiled to circuits/*/target/"
