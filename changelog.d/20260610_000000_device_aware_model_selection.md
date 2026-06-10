---
bump: minor
---

### Added
- Device-aware model selection: detect the user's device (RAM via `navigator.deviceMemory`, CPU cores, mobile/desktop, WebGPU, storage quota) and show which models actually fit
- Curated catalog of browser-runnable open-weights models (SmolLM2 135M/360M/1.7B, TinyLlama 1.1B) with parameter counts, file sizes and popularity verified against the HuggingFace Hub API
- `ModelSelector` UI component with per-model fit badges (`Fits` / `Tight` / `Too large`), download/memory estimates and HuggingFace downloads/likes
- Automatic recommendation of the most popular model that comfortably fits the current device, auto-loaded on first visit
- On-demand model download (model files fetched only when a model is selected or recommended)
- Responsive layout for phones, tablets and PCs (single-column model grid at ≤640px)
- Unit tests for the catalog, device-fit estimation, recommendation logic and formatters
- Case study documentation in `docs/case-studies/issue-11/` (requirements, deep analysis, HuggingFace/models.dev data, device-detection math, library comparison)

### Changed
- Replaced the single hard-coded model in `App.tsx` with the device-aware catalog; prompts are now formatted using the loaded model's chat template (ChatML for SmolLM2, Zephyr for TinyLlama)
- Header renamed to "Models in Browser" to reflect multi-model support
</content>
