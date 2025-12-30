# Model in Browser

Run [SmolLM2](https://huggingface.co/collections/HuggingFaceTB/smollm2) language model directly in your web browser using WebAssembly - no server processing required!

[![CI/CD Pipeline](https://github.com/link-assistant/model-in-browser/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/link-assistant/model-in-browser/actions)
[![Deploy to GitHub Pages](https://github.com/link-assistant/model-in-browser/workflows/Build%20and%20Deploy%20to%20GitHub%20Pages/badge.svg)](https://github.com/link-assistant/model-in-browser/actions)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

## Features

- **100% Client-Side**: All AI inference happens in your browser - no data sent to servers
- **WebAssembly Powered**: Rust compiled to WASM for near-native performance
- **Web Worker**: Model runs in background thread for responsive UI
- **React Chat UI**: Modern chat interface using [@chatscope/chat-ui-kit-react](https://github.com/chatscope/chat-ui-kit-react)
- **SmolLM2-135M**: Compact 135M parameter model optimized for edge deployment
- **GitHub Pages Ready**: Deploy as a static site with no backend required

## Demo

Visit the [live demo](https://link-assistant.github.io/model-in-browser/) to try the model in your browser.

> **Note**: First load downloads ~270MB of model weights. The model is cached by your browser for subsequent visits.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │   React Chat    │    │        Web Worker                │ │
│  │   UI (Main      │◄──►│  ┌─────────────────────────┐    │ │
│  │   Thread)       │    │  │   WASM Module           │    │ │
│  │                 │    │  │  ┌─────────────────┐    │    │ │
│  │  @chatscope/    │    │  │  │  Candle (Rust)  │    │    │ │
│  │  chat-ui-kit    │    │  │  │  SmolLM2-135M   │    │    │ │
│  └─────────────────┘    │  │  └─────────────────┘    │    │ │
│                         │  └─────────────────────────┘    │ │
│                         └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) (18+)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/link-assistant/model-in-browser.git
cd model-in-browser

# Build the WASM package
./scripts/build-wasm.sh

# Install web dependencies and start dev server
cd web
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
# Build WASM
cd wasm && wasm-pack build --target web --out-dir ../web/src/pkg

# Build web app
cd web && npm run build

# Serve with the Rust server
cargo run --manifest-path server/Cargo.toml -- --dir web/dist
```

## Project Structure

```
.
├── wasm/                    # Rust WASM library for model inference
│   ├── src/lib.rs           # SmolLM2 WASM bindings
│   └── Cargo.toml           # WASM package config
├── web/                     # React web application
│   ├── src/
│   │   ├── App.tsx          # Main chat component
│   │   ├── worker.ts        # Web Worker for inference
│   │   └── pkg/             # Built WASM package
│   ├── package.json
│   └── vite.config.ts
├── server/                  # Local development server
│   └── src/main.rs          # Axum server with CORS
├── .github/workflows/
│   ├── release.yml          # CI/CD pipeline
│   └── deploy.yml           # GitHub Pages deployment
└── scripts/
    ├── build-wasm.sh        # Build WASM package
    └── dev.sh               # Start development environment
```

## How It Works

1. **Model Loading**: When you click "Load Model", the web app downloads:
   - Model weights (~270MB safetensors file)
   - Tokenizer configuration
   - Model configuration

2. **Web Worker**: The WASM module runs in a Web Worker to keep the UI responsive during inference.

3. **Text Generation**: The model uses the LLaMA architecture implemented in [Candle](https://github.com/huggingface/candle), HuggingFace's minimalist ML framework for Rust.

4. **Streaming Output**: Tokens are generated one at a time and streamed to the chat UI for real-time response display.

## Technology Stack

- **Inference Engine**: [Candle](https://github.com/huggingface/candle) - Rust ML framework with WASM support
- **Model**: [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct)
- **Frontend**: React 18 with TypeScript
- **Chat UI**: [@chatscope/chat-ui-kit-react](https://chatscope.io/)
- **Build Tool**: Vite
- **WASM Toolchain**: wasm-pack, wasm-bindgen

## Browser Requirements

- Modern browser with WebAssembly support
- ~512MB free memory for model loading
- Chrome, Firefox, Safari, or Edge (latest versions)

## Development

### Running Tests

```bash
# Rust tests
cargo test

# Web tests
cd web && npm test
```

### Code Quality

```bash
# Format Rust code
cargo fmt

# Run Clippy lints
cargo clippy --all-targets --all-features

# Lint web code
cd web && npm run lint
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Add a changelog fragment in `changelog.d/`
5. Submit a pull request

## License

[Unlicense](LICENSE) - Public Domain

## Acknowledgments

- [HuggingFace](https://huggingface.co/) for SmolLM2 and Candle
- [Candle](https://github.com/huggingface/candle) team for the WASM-compatible ML framework
- [chatscope](https://chatscope.io/) for the React chat UI components

## Resources

- [SmolLM2 Collection](https://huggingface.co/collections/HuggingFaceTB/smollm2)
- [Candle WASM Examples](https://github.com/huggingface/candle/tree/main/candle-wasm-examples)
- [WebAssembly Rust Guide](https://rustwasm.github.io/docs/book/)
