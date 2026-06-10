# Device Detection & Fit Estimation

How the app decides, **entirely client-side**, which models — and at **which
quantization** — a device can run. Implemented in
[`web/src/models/device.ts`](../../../web/src/models/device.ts).

## The probes and their support matrix

| Probe | What it gives | Support | How we use it |
|-------|---------------|---------|---------------|
| `navigator.deviceMemory` | RAM in GiB, bucketed `{0.25,0.5,1,2,4,8}` | **Chromium only** (absent in Firefox, Safari, iOS) | Primary RAM hint; when absent we fall back to the backend ceiling |
| `navigator.hardwareConcurrency` | logical CPU cores | Broad; **clamped** (iOS=2, WebKit caps 8) | Displayed; used to size thread pools — **not** as a memory proxy |
| `navigator.storage.estimate()` | origin `{quota, usage}` bytes | Most modern browsers; can throw in private mode | Gate: is there room to cache the download? |
| `navigator.gpu.requestAdapter()` | a **usable** WebGPU adapter | Chromium + recent Safari/FF | Probed at startup; a real adapter switches the model to the larger **GPU budget** and the WebGPU execution path |
| User-Agent string | device class | Universal (but spoofable) | Heuristic mobile/tablet detection |

Each probe is defensively guarded (`typeof navigator === 'undefined'`, feature
checks, try/catch) so detection never throws in SSR, web-worker, or
private-browsing contexts. Note the distinction between `hasWebGpu` (the
`navigator.gpu` surface exists) and `webGpuAdapter` (an adapter was actually
acquired) — only the latter unlocks GPU acceleration, because `navigator.gpu` can
exist without a usable adapter (blocklisted GPU, headless CI).

## Two memory budgets: WASM/CPU vs WebGPU

Because the default Transformers.js engine can run on **WebGPU** (weights in GPU
buffers) or **WASM** (weights in the wasm32 linear address space), and the candle
engine is WASM/CPU-only, fit is evaluated against the budget that applies to the
chosen path (`budgetFor(entry, caps)` picks the GPU budget only when the model
supports WebGPU **and** a usable adapter was found).

### WASM/CPU budget — `estimateMemoryBudget(deviceMemoryGb, isMobile)`

```
budget = 2 GB                              // wasm32 practical single-allocation ceiling
if deviceMemoryGb known: budget = min(budget, deviceMemoryGb * 0.5)   // reserve half of RAM
if isMobile:             budget = min(budget, 1 GB)                   // phones kill tabs early
return max(budget, 700 MB)                 // never below the smallest model, so there is always a default
```

- **2 GB ceiling** — WebAssembly linear memory is capped at 4 GiB and a single
  contiguous allocation rarely survives past ~2 GB before `memory.grow` fails;
  independent of physical RAM. ([V8: 4GiB wasm memory](https://v8.dev/blog/4gb-wasm-memory))
- **× 0.5 of RAM** — the OS, browser, page and other tabs all need memory.
- **1 GB mobile cap** — mobile browsers reclaim tabs aggressively.
- **700 MB floor** — guarantees a default model is always offered.

### WebGPU budget — `estimateGpuBudget(deviceMemoryGb, isMobile)`

```
budget = 4 GB                              // GPU buffers are not bound by the wasm32 ceiling
if deviceMemoryGb known: budget = min(budget, deviceMemoryGb * 0.6)   // integrated GPUs share system RAM
if isMobile:             budget = min(budget, 1.5 GB)                 // mobile GPUs/memory are tighter
return max(budget, 700 MB)
```

The GPU budget is larger because WebGPU stores weights in GPU buffers rather than
the constrained wasm32 address space — which, combined with quantization, is what
lets 1B+ models run on capable devices.

Both budgets are deliberately **conservative**: over-promising causes an OOM tab
crash mid-download, a far worse experience than recommending a slightly smaller
model or quantization.

## Runtime footprint estimate (per quantization)

`estimateRuntimeBytes(entry, dtype)`:

- **Transformers.js**: `downloadBytes(entry, dtype) × 1.3` — the quantized ONNX
  weights are kept roughly as-is in memory, plus ~30% overhead for activations,
  the KV cache and runtime structures. So the footprint scales with the **chosen
  dtype**: the same model at `q4f16` costs ~4× less than at `fp32`.
- **candle**: `parameters × 4 × 1.3` — F32 weights (4 bytes/param), no
  quantization, plus the same ~30% overhead.

## Fit classification (per dtype)

`evaluateFitForDtype(entry, caps, dtype)` computes
`budgetFraction = runtimeBytes / budgetFor(entry, caps)`:

| Fraction | Level | UI |
|----------|-------|----|
| ≤ 0.80 | `fits` | green "Fits" — "Comfortably fits this device." (or "…with WebGPU acceleration.") |
| ≤ 1.00 | `tight` | amber "Tight" — "Should run, but close to this device's limit." |
| > 1.00 | `too-large` | red "Too large" (card disabled) — "Needs more memory than this device can safely provide." |

A separate **storage gate** (`insufficientStorage`) compares free origin storage
(`quota − usage`) against `downloadBytes × 1.1`; when storage is known and too
small, the card explains the model can't be cached even if it would otherwise fit.

## Picking the quantization — `pickBestDtype(entry, caps)`

For Transformers.js models the app auto-selects the **highest-quality dtype that
fits**: it walks the variants from best quality to most-compressed
(fp32 > fp16 > q8 > q4 > q4f16), returns the first that `fits`, else the best that
is at most `tight`, else the smallest variant (so the card can still render, even
if marked too-large). This is the mechanism behind "exactly the models — and
precision — that fit this device".

## Worked example A — WebGPU desktop (deviceMemory ≈ 8, adapter present)

- Budget = `min(4 GB, 8 × 0.6 GB)` = 4 GB (GPU path).
- TinyLlama-1.1B → q8 ~1.1 GB × 1.3 ≈ 1.43 GB / 4 GB = 0.36 → **Fits** at q8.
- Phi-3.5-mini (3.8B, q4f16 only) → ~2.32 GB × 1.3 ≈ 3.01 GB / 4 GB = 0.75 → **Fits**.
- The most-downloaded model that fits comfortably is recommended.

## Worked example B — WASM desktop (deviceMemory ≈ 8, no adapter)

- Budget = `min(2 GB, 8 × 0.5 GB)` = 2 GB (WASM path).
- SmolLM2-135M → q8 ~137 MB × 1.3 ≈ 0.18 GB → **Fits**.
- TinyLlama-1.1B → q4f16 ~714 MB × 1.3 ≈ 0.93 GB / 2 GB = 0.46 → **Fits** at 4-bit.
- SmolLM2-1.7B → q4f16 ~1.11 GB × 1.3 ≈ 1.44 GB / 2 GB = 0.72 → **Fits** (4-bit).
- Phi-3.5-mini → ~2.32 GB × 1.3 ≈ 3.01 GB / 2 GB = 1.51 → **Too large**.

## On phones

With `isMobile = true` the budgets tighten (1 GB WASM / 1.5 GB WebGPU), so the app
leans toward smaller models and the most-compressed quantization that still fits —
honouring the issue's requirement to "support all devices, phones, tablets, pcs".
The responsive CSS additionally collapses the selector grid to a single column at
≤640px.
