---
bump: minor
---

### Added
- Device-aware model selection: detect the user's device (RAM via `navigator.deviceMemory`, CPU cores, mobile/desktop, a real WebGPU adapter probe, storage quota) and show which models — and at which quantization — actually fit
- Second inference engine, **Transformers.js (ONNX Runtime Web)**, as the default: runs on **WebGPU** when a usable adapter is available with an automatic **WASM/CPU** fallback; the original Rust/candle WebAssembly engine is kept as a selectable option (nothing removed)
- **Quantization-aware** catalog: each Transformers.js model exposes its `q4f16` / `q4` / `q8` / `fp16` / `fp32` variants, and the app auto-selects the highest-quality quantization that fits the device (4-bit cuts memory ~4× vs F32, unlocking 1B+ models on phones)
- **Multi-architecture** catalog spanning Llama, Qwen2, Phi-3, Gemma and SmolLM2 (135M → 3.8B): SmolLM2 135M/360M/1.7B, Qwen2.5 0.5B/1.5B, Gemma 3 1B, TinyLlama 1.1B, Phi-3.5-mini, with parameter counts, per-dtype file sizes and popularity verified against the HuggingFace Hub API
- **Dynamic catalog**: live HuggingFace Hub discovery (`discoverModels`, `fetchLiveVariants`, `fetchLivePopularity`, `fetchLiveCatalogSizes`) merged with the static seed so offerings stay fresh, with offline/CI fallback
- Separate **WebGPU vs WASM memory budgets** and per-(engine, dtype) runtime estimation for honest fit classification
- `ModelSelector` UI component with per-model fit badges (`Fits` / `Tight` / `Too large`), chosen quantization, download/memory estimates, WebGPU-vs-CPU acceleration, and HuggingFace downloads/likes
- Automatic recommendation of the most popular model that comfortably fits the current device, auto-loaded on first visit; `?model=` / `?dtype=` URL overrides for deterministic loads
- On-demand model download (model files fetched only when a model is selected or recommended); ORT WASM served same-origin from `./ort/` so inference works offline, in CI, and under cross-origin isolation
- Responsive layout for phones, tablets and PCs (single-column model grid at ≤640px)
- Unit tests for the multi-engine catalog, per-dtype device-fit estimation, dtype selection, budget math, recommendation logic, catalog merge/dedup and formatters
- Case study documentation in `docs/case-studies/issue-11/` (requirements, deep analysis, HuggingFace/models.dev data, device-detection math, library comparison)
- Dependency: `@huggingface/transformers` (Transformers.js / ONNX Runtime Web)

### Changed
- Replaced the single hard-coded model in `App.tsx` with the device-aware, dual-engine catalog; Transformers.js models use the tokenizer's built-in chat template, the candle engine uses manual templates (ChatML for SmolLM2, Zephyr for TinyLlama)
- Header renamed to "Models in Browser" to reflect multi-model support
