#!/bin/bash
# Build the WASM package for browser use

set -e

echo "Building SmolLM2 WASM package..."

cd "$(dirname "$0")/../wasm"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "Error: wasm-pack is not installed."
    echo "Install it with: cargo install wasm-pack"
    exit 1
fi

# Build for web target
wasm-pack build --target web --out-dir ../web/src/pkg

echo "WASM package built successfully!"
echo "Output: web/src/pkg/"
