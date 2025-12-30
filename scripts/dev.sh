#!/bin/bash
# Start the development environment

set -e

cd "$(dirname "$0")/.."

echo "Starting development environment..."

# Build WASM if not already built
if [ ! -d "web/src/pkg" ]; then
    echo "Building WASM package..."
    ./scripts/build-wasm.sh
fi

# Install npm dependencies if needed
if [ ! -d "web/node_modules" ]; then
    echo "Installing npm dependencies..."
    cd web && npm install && cd ..
fi

# Start the Vite dev server
echo "Starting Vite dev server..."
cd web && npm run dev
