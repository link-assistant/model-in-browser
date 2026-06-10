# Device Detection & Fit Estimation

How the app decides, **entirely client-side**, which models a device can run.
Implemented in [`web/src/models/device.ts`](../../../web/src/models/device.ts).

## The probes and their support matrix

| Probe | What it gives | Support | How we use it |
|-------|---------------|---------|---------------|
| `navigator.deviceMemory` | RAM in GiB, bucketed `{0.25,0.5,1,2,4,8}` | **Chromium only** (absent in Firefox, Safari, iOS) | Primary RAM hint; when absent we fall back to the wasm32 ceiling |
| `navigator.hardwareConcurrency` | logical CPU cores | Broad; **clamped** (iOS=2, WebKit caps 8) | Displayed; used to size thread pools — **not** as a memory proxy |
| `navigator.storage.estimate()` | origin `{quota, usage}` bytes | Most modern browsers; can throw in private mode | Gate: is there room to cache the download? |
| `navigator.gpu` | WebGPU presence | Chromium + recent Safari/FF behind flags | Displayed as a capability hint; future acceleration path |
| User-Agent string | device class | Universal (but spoofable) | Heuristic mobile/tablet detection |

Each probe is defensively guarded (`typeof navigator === 'undefined'`, feature
checks, try/catch) so detection never throws in SSR, web-worker, or
private-browsing contexts.

## The memory budget

`estimateMemoryBudget(deviceMemoryGb, isMobile)`:

```
budget = 2 GB                              // wasm32 practical single-allocation ceiling
if deviceMemoryGb known: budget = min(budget, deviceMemoryGb * 0.5)   // reserve half of RAM
if isMobile:             budget = min(budget, 1 GB)                   // phones kill tabs early
return max(budget, 700 MB)                 // never below the smallest model, so there is always a default
```

Rationale for each clamp:
- **2 GB ceiling** — WebAssembly linear memory is capped at 4 GiB and a single
  contiguous allocation rarely survives past ~2 GB before `memory.grow` fails.
  This is independent of physical RAM. ([V8: 4GiB wasm memory](https://v8.dev/blog/4gb-wasm-memory))
- **× 0.5 of RAM** — the OS, the browser, the page and other tabs all need memory;
  half of total RAM is a conservative single-allocation share.
- **1 GB mobile cap** — mobile browsers reclaim tabs aggressively, well below the
  wasm32 ceiling.
- **700 MB floor** — guarantees the smallest model (135M, ~0.67 GB) is always
  offered, so the UI never shows an empty/"nothing fits" state by default.

The budget is deliberately **conservative**: over-promising causes an OOM tab
crash mid-download, which is a far worse experience than recommending a slightly
smaller model.

## Runtime footprint estimate

`estimateRuntimeBytes(entry) = parameters × 4 × 1.3`

- **× 4** — the engine holds weights as **F32** (4 bytes/param) in memory.
- **× 1.3** — ~30% overhead for activations, the KV cache, and tokenizer/runtime
  structures over a short chat context.

## Fit classification

`evaluateFit()` computes `budgetFraction = runtimeBytes / memoryBudgetBytes`:

| Fraction | Level | UI |
|----------|-------|----|
| ≤ 0.80 | `fits` | green "Fits" — "Comfortably fits this device." |
| ≤ 1.00 | `tight` | amber "Tight" — "Should run, but close to this device's memory limit." |
| > 1.00 | `too-large` | red "Too large" (card disabled) — "Needs more memory than this device can safely provide." |

A separate **storage gate** (`insufficientStorage`) compares free origin storage
(`quota − usage`) against `downloadBytes × 1.1`; when storage is known and too
small, the card explains the model can't be cached even if it would otherwise fit.

## Worked example (typical desktop, deviceMemory ≈ 8)

- Budget = `min(2 GB, 8 × 0.5 GB)` = 2 GB (desktop, not clamped by mobile).
- 135M → 0.67 GB / 2 GB = 0.33 → **Fits**
- 360M → 1.79 GB / 2 GB = 0.90 → **Tight**
- 1.1B → 5.32 GB / 2 GB = 2.66 → **Too large**
- 1.7B → 8.28 GB / 2 GB = 4.14 → **Too large**

This matches the rendered desktop screenshot exactly, and is why the **135M**
model — the most popular model that *fits comfortably* — is auto-recommended.

## On phones

With `isMobile = true` the budget is capped at 1 GB, so only the 135M model
remains a comfortable fit and is recommended — honouring the issue's requirement
to "support all devices, phones, tablets, pcs". The responsive CSS additionally
collapses the selector grid to a single column at ≤640px.
</content>
