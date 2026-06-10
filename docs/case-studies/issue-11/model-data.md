# Model Catalog Data (HuggingFace Hub API)

All values verified against the live HuggingFace Hub API on **2026-06-10**.
The catalog spans **small, open-weights** models across multiple architectures
(Llama, Qwen2, Phi-3, Gemma, SmolLM2), each loadable in the browser via the
default **Transformers.js (ONNX Runtime Web)** engine, plus one **candle**
(Rust/WASM, F32) entry. At runtime this static seed is **merged with live Hub
discovery** (`hub.ts`) so the offerings stay fresh; the seed guarantees the app
works offline / in CI.

## How the data was collected

```bash
# Parameter count, downloads, likes:
curl -s "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-135M-Instruct?expand=downloads&expand=likes&expand=safetensors"
#   -> .safetensors.total  (parameters)
#   -> .downloads          (last 30 days)
#   -> .likes

# Per-quantization ONNX file sizes (transformers engine):
curl -s "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-135M-Instruct/tree/main/onnx"
#   -> [{path: "onnx/model_q4f16.onnx", size}, {path: "onnx/model_q8.onnx", size}, ...]
#      (+ external "model_*.onnx_data" where present)

# Safetensors file sizes (candle engine):
curl -s "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-135M-Instruct/tree/main"
#   -> [{path, size}, ...] for model.safetensors, tokenizer.json, config.json

# Discover additional ONNX-ready models at runtime:
curl -s "https://huggingface.co/api/models?search=onnx-community&filter=transformers.js"
```

Direct download URLs follow the pattern `https://huggingface.co/{repo}/resolve/{revision}/{file}`.
Transformers.js streams the `onnx/model_{dtype}.onnx` files for the chosen
quantization; the candle worker streams the safetensors trio.

## Transformers.js catalog (smallest → largest)

Sizes are the combined `onnx/model_{dtype}.onnx` (+ external `_data`) totals in
bytes. The app auto-picks the highest-quality dtype that fits the device.

### 1. SmolLM2-135M-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-135M-Instruct` · **Architecture**: SmolLM2 (Llama-family) · **WebGPU**: yes
- **Parameters**: 134,515,008 · **Popularity**: 1,543,897 downloads · 340 likes
- **Variants**: q4f16 117,691,126 · q8 137,147,981 · q4 182,068,553 · fp16 270,267,067 · fp32 540,345,794

### 2. Qwen2.5-0.5B-Instruct
- **Repo**: `onnx-community/Qwen2.5-0.5B-Instruct` · **Architecture**: Qwen2 · **WebGPU**: yes
- **Parameters**: 494,032,768 · **Popularity**: 5,729 downloads · 15 likes
- **Variants**: q4f16 483,003,582 · q8 512,096,557 · q4 786,156,820 · fp16 997,354,499 · fp32 1,993,796,793

### 3. SmolLM2-360M-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-360M-Instruct` · **Architecture**: SmolLM2 · **WebGPU**: yes
- **Parameters**: 361,821,120 · **Popularity**: 270,596 downloads · 193 likes
- **Variants**: q4f16 272,737,275 · q8 364,564,671 · q4 387,943,246 · fp16 724,891,911 · fp32 1,449,582,810

### 4. Gemma-3-1B-it
- **Repo**: `onnx-community/gemma-3-1b-it-ONNX` · **Architecture**: Gemma · **WebGPU**: yes
- **Parameters**: 999,885,952 · **Popularity**: 677 downloads · 25 likes
- **Variants**: q4f16 763,529,245 · q4 859,454,179 · q8 1,001,481,982 · fp16 2,033,972,730 · fp32 2,070,575,091

### 5. TinyLlama-1.1B-Chat-v1.0
- **Repo**: `Xenova/TinyLlama-1.1B-Chat-v1.0` · **Architecture**: Llama · **WebGPU**: yes
- **Parameters**: 1,100,048,384 · **Popularity**: 2,080,952 downloads · 1,614 likes
- **Variants**: q4f16 713,747,554 · q4 909,644,834 · q8 1,101,090,183 · fp16 2,200,717,222 · fp32 4,400,802,762

### 6. Qwen2.5-1.5B-Instruct
- **Repo**: `onnx-community/Qwen2.5-1.5B-Instruct` · **Architecture**: Qwen2 · **WebGPU**: yes
- **Parameters**: 1,543,714,304 · **Popularity**: 1,458 downloads · 6 likes
- **Variants**: q4f16 1,221,878,940 · q8 1,578,954,293 · q4 1,787,566,590 · fp16 3,105,275,452 · fp32 6,209,469,491

### 7. SmolLM2-1.7B-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-1.7B-Instruct` · **Architecture**: SmolLM2 · **WebGPU**: yes
- **Parameters**: 1,711,376,384 · **Popularity**: 168,446 downloads · 733 likes
- **Variants**: q4f16 1,108,730,338 · q4 1,411,969,607 · q8 1,714,119,778 · fp16 3,423,959,956 · fp32 6,847,768,268

### 8. Phi-3.5-mini-instruct
- **Repo**: `onnx-community/Phi-3.5-mini-instruct-onnx-web` · **Architecture**: Phi-3 · **WebGPU**: yes
- **Parameters**: 3,821,079,552 · **Popularity**: 678 downloads · 15 likes
- **Variants**: q4f16 2,317,473,274 (4-bit only — the web-optimised ONNX export)

## candle (Rust/WASM, F32) catalog

### SmolLM2-135M (candle)
- **Repo**: `HuggingFaceTB/SmolLM2-135M-Instruct` · **Architecture**: Llama loader · **Prompt**: ChatML · **WebGPU**: no (CPU-only)
- **Parameters**: 134,515,008 · **Popularity**: 1,543,897 downloads · 340 likes
- **Files**: `model.safetensors` 269,060,552 B · `tokenizer.json` 2,104,556 B · `config.json` 861 B
- Preserves the project's original pure-Rust path; loads F32 safetensors directly (no ONNX, no quantization).

## Why this catalog

- **Multiple architectures** — Transformers.js loads Llama, Qwen2, Phi-3 and
  Gemma, so the catalog is no longer restricted to a single family.
- **All ungated** — anonymous browser downloads succeed without an access token.
- **They span the fit gradient** — from "fits a phone" (135M) to "needs a WebGPU
  desktop" (Phi-3.5-mini 3.8B), so the UI demonstrates `Fits` / `Tight` /
  `Too large` honestly on a single device — and how the verdict changes with the
  selected quantization.
- **TinyLlama is the popularity anchor** — the most-downloaded of the set; with
  4-bit quantization it now *fits* many devices, which is precisely the
  "most popular ∧ fits" case the issue asks for.

## Quantization vs. runtime memory

For the Transformers.js engine the **download size is the dominant runtime term**:
the quantized ONNX weights are kept roughly as-is in memory, so footprint
≈ `download(dtype) × 1.3`. Picking a smaller dtype (e.g. `q4f16`) cuts memory ~4×
versus `fp32` — that is what makes 1B+ models viable in a browser. The candle
engine, by contrast, expands weights to **F32 in memory** (~4 bytes/param) with no
quantization. Runtime memory — not download size — determines fit; see
[`device-detection.md`](./device-detection.md).
