---
bump: patch
---

### Changed
- Marked `model-in-browser`, `model-server` and `smollm2-wasm` as `publish = false`:
  they are an application, a local development server and a WebAssembly build for
  the web UI, not libraries meant for crates.io. Releases continue to ship via
  GitHub Releases and GitHub Pages.
