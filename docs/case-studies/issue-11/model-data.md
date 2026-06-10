# Model Catalog Data (HuggingFace Hub API)

All values verified against the live HuggingFace Hub API on **2026-06-10**.
The catalog is restricted to **ungated `LlamaForCausalLM`** models small enough
to load in the browser via the project's candle/WASM engine.

## How the data was collected

```bash
# Parameter count, downloads, likes:
curl -s "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-135M-Instruct?expand=downloads&expand=likes&expand=safetensors"
#   -> .safetensors.total  (parameters)
#   -> .downloads          (last 30 days)
#   -> .likes

# Per-file byte sizes:
curl -s "https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-135M-Instruct/tree/main"
#   -> [{path, size}, ...] for model.safetensors, tokenizer.json, config.json
```

Direct download URLs follow the pattern:

```
https://huggingface.co/{repo}/resolve/{revision}/{file}
```

These are the exact URLs the worker streams on demand (e.g.
`https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors`).

## Catalog (smallest → largest)

### 1. SmolLM2-135M-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-135M-Instruct`
- **Architecture**: `LlamaForCausalLM` · **Prompt**: ChatML
- **Parameters**: 134,515,008
- **Files**: `model.safetensors` 269,060,552 B · `tokenizer.json` 2,104,556 B · `config.json` 861 B
- **Popularity**: 1,543,897 downloads · 340 likes
- **F32 runtime (×1.3)**: ~0.67 GB → fits virtually every device, including phones.

### 2. SmolLM2-360M-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-360M-Instruct`
- **Architecture**: `LlamaForCausalLM` · **Prompt**: ChatML
- **Parameters**: 361,821,120
- **Files**: `model.safetensors` 723,674,912 B · `tokenizer.json` 2,104,556 B · `config.json` 846 B
- **Popularity**: 270,596 downloads · 193 likes
- **F32 runtime (×1.3)**: ~1.8 GB → tight on a 2 GB budget; good for tablets/PCs.

### 3. TinyLlama-1.1B-Chat-v1.0
- **Repo**: `TinyLlama/TinyLlama-1.1B-Chat-v1.0`
- **Architecture**: `LlamaForCausalLM` · **Prompt**: Zephyr
- **Parameters**: 1,100,048,384
- **Files**: `model.safetensors` 2,200,119,864 B · `tokenizer.json` 1,842,767 B · `config.json` 608 B
- **Popularity**: 2,080,952 downloads · 1,614 likes
- **F32 runtime (×1.3)**: ~5.3 GB → exceeds the wasm32-practical budget on most devices.

### 4. SmolLM2-1.7B-Instruct
- **Repo**: `HuggingFaceTB/SmolLM2-1.7B-Instruct`
- **Architecture**: `LlamaForCausalLM` · **Prompt**: ChatML
- **Parameters**: 1,711,376,384
- **Files**: `model.safetensors` 3,422,777,952 B · `tokenizer.json` 2,104,556 B · `config.json` 908 B
- **Popularity**: 168,446 downloads · 733 likes
- **F32 runtime (×1.3)**: ~8.3 GB → too large for the browser today; included to show the gradient and as a target for future quantization.

## Why these four

- **All `LlamaForCausalLM`** — the only architecture the current WASM engine loads.
- **All ungated** — anonymous browser downloads succeed without an access token.
- **They span the fit gradient** — from "fits a phone" (135M) to "too large for any browser today" (1.7B), which lets the UI demonstrate `Fits` / `Tight` / `Too large` honestly on a single device.
- **TinyLlama is the popularity anchor** — it is the most-downloaded of the four, which is precisely the case that proves "most popular" must be intersected with "fits" (it is too large on a 2 GB budget, so 135M is recommended instead).

## Important: F32 vs. quantized

The byte sizes above are the **safetensors download** (F16/BF16 on disk). The
engine expands weights to **F32 in memory** (~4 bytes/param), so the *runtime*
footprint is roughly **double the download** plus activation/KV overhead. Runtime
memory — not download size — is what determines fit. See
[`device-detection.md`](./device-detection.md).
</content>
