# Library & Data-Source Comparison

Evaluation of the existing components and data sources named in (or relevant to)
[issue #11](https://github.com/link-assistant/model-in-browser/issues/11),
and the reasoning behind each choice.

## 1. Model metadata source: models.dev vs. HuggingFace Hub API

The issue suggests "something like https://models.dev (find source code of it,
it open-source)".

### models.dev
- **Source**: [github.com/sst/models.dev](https://github.com/sst/models.dev) — MIT licensed, by SST.
- **Shape**: per-provider/-model TOML, compiled to a single `https://models.dev/api.json`.
- **Has**: provider, modality, context window, pricing, an `open_weights` boolean, tool-use flags.
- **Lacks**: **model file sizes** and **parameter counts** — the two figures we need to decide browser fit. It is provider/pricing-centric (aimed at *hosted* API models), not at sizing local weights.

**Verdict**: great for discovering *which* models are open-weights, but **cannot
answer "does it fit this device"** on its own. Kept as a possible future source
if the app ever lists hosted/remote models.

### HuggingFace Hub API ✅ (chosen)
- `GET /api/models/{id}?expand=downloads&expand=likes&expand=safetensors` → `safetensors.total` (params), `downloads`, `likes`.
- `GET /api/models/{id}/tree/main` → exact per-file byte sizes.
- Direct, tokenless download URLs: `https://huggingface.co/{repo}/resolve/{rev}/{file}`.

**Verdict**: the **only** source that provides both **file sizes** and
**popularity**, plus the actual download URLs. Used as the authoritative source,
with a **static fallback** compiled into `catalog.ts` so the app still works
offline / when the API is unreachable.

| Capability | models.dev | HF Hub API |
|------------|:----------:|:----------:|
| Open-weights flag | ✅ | ✅ (via tags/architecture) |
| Parameter count | ❌ | ✅ |
| File byte sizes | ❌ | ✅ |
| Downloads / likes | ❌ | ✅ |
| Direct download URL | ❌ | ✅ |
| License/MIT, self-hostable | ✅ | n/a (public API) |

## 2. Device detection

| Option | Verdict |
|--------|---------|
| Native `navigator.deviceMemory` / `hardwareConcurrency` / `storage.estimate` / `navigator.gpu.requestAdapter` ✅ | **Chosen** — zero new dependencies, degrades gracefully, and probes for a **usable** WebGPU adapter (not just the API surface) to pick the GPU vs WASM budget. See [device-detection.md](./device-detection.md). |
| `detect-gpu` (npm) | Rejected — adds a benchmark dependency aimed at game-graphics tiering; we need memory budgeting, not GPU FPS tiers. |
| UA-parser libraries | Rejected for sizing; a small inline UA regex is enough for the mobile heuristic. |

## 3. In-browser inference engine

The repo already shipped a candle-based Rust→WASM engine with a **Llama** loader.
This PR adds a second engine so the catalog can span many architectures with
WebGPU acceleration and quantization — **without removing** the original.

| Option | Verdict |
|--------|---------|
| [transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`, ONNX Runtime Web) ✅ | **Chosen as the default** — WebGPU execution provider with an automatic WASM fallback; quantized weights (`q4` / `q4f16` / `q8` / `fp16` / `fp32`); loads Llama, Qwen2, Phi-3, Gemma and more; uses each tokenizer's built-in chat template. ONNX weights for the chosen dtype stream from the Hub on demand. ORT WASM is served same-origin from `./ort/` so it works offline / in CI / under cross-origin isolation. |
| Keep the existing candle/WASM engine ✅ | **Kept as a selectable option** — the pure-Rust path is preserved for SmolLM2-135M. CPU-only, F32 weights, `LlamaForCausalLM` loader. Nothing was removed. |
| [web-llm](https://github.com/mlc-ai/web-llm) (MLC) | Rejected for this PR — also WebGPU/multi-architecture, but a much larger dependency and a different (MLC-compiled) model format; transformers.js reuses the Hub's ONNX assets directly. |

Running **two engines** gives the broad coverage the issue asks for (any small
ONNX-ready model, quantized, GPU-accelerated) while keeping the demonstrable
pure-Rust candle path intact. The worker dispatches per catalog entry's `engine`
field.

## 4. UI components (formal-ai best practices)

The issue asks to reuse "best practices from github.com/link-assistant/formal-ai
… relevant to neural networks in the browser and markdown support. Maybe we can
copy most of UI components."

That guidance was already actioned in the sibling chat-UI work
([issue #9 case study](../issue-9/README.md)), which vendored:
- **@chatscope/chat-ui-kit-react** — the chat surface (message list, input, typing indicator).
- **react-markdown** (+ remark-gfm) — markdown rendering of assistant messages.
- A switchable chat-provider abstraction.

This PR **reuses that stack unchanged** and adds one new component:

- **`ModelSelector`** — a device-summary header (RAM / cores / mobile / real
  WebGPU status / budget) plus a responsive card grid. Each card mirrors the
  existing dark-theme styling and shows the model's fit, chosen quantization,
  download size, memory estimate, WebGPU-vs-CPU acceleration, and popularity. It
  is the neural-network-in-the-browser piece that issue #11 specifically needs and
  that the generic chat libraries don't provide.

| Chat-UI option | Status |
|----------------|--------|
| chatscope + react-markdown (vendored) ✅ | **Reused** — markdown support preserved. |
| assistant-ui | Considered in issue #9; not adopted to avoid a disruptive migration. |
| reachat | Considered in issue #9; smaller community. |

**Net**: no UI library churn in this PR — we copy/reuse the components already
established from formal-ai best practices and add the missing model-selection UI.
</content>
