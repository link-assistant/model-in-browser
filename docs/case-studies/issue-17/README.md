# Case study — issue #17: Qwen 2.5 instruct loading failed

## Executive summary

The screenshot is a Safari session on the deployed GitHub Pages app. SmolLM2
loads and answers two prompts, proving that the page, worker, ORT WASM backend,
model download, chat template, and generation loop are operational. The user
then selects **Qwen2.5 1.5B Instruct**, shown as **q4f16**, **1.1 GB download**,
**~1.5 GB estimated memory**, and **CPU**. Loading ends with Emscripten's opaque
`Error: Aborted(). Build with -sASSERTIONS for more info.`

The root cause is the selector's under-estimation of peak memory on the ORT
WASM path. It used `download bytes × 1.3` and compared that with a 2 GiB budget,
but did not include the additional WASM heap needed by ORT's graph,
initializers, allocator, and session construction. That made a 1.22 GB Qwen
graph appear runnable near wasm32's practical limit. The process abort occurs
below JavaScript's recoverable exception boundary, hence the unhelpful error.

The fix uses a conservative additional 1.8× WASM-heap factor (2.34× download
bytes including the existing model/KV estimate), while retaining the existing
1.3× estimate for WebGPU. Qwen2.5 1.5B is consequently hidden as too large on
CPU-only devices and remains available at q4f16 on WebGPU devices. A failed
WebGPU load is allowed to retry on WASM only when the same model and dtype pass
the CPU fit calculation. The smallest fallback variant is now selected by its
actual byte count, because Qwen's q4 artifact is larger than q8.

## Preserved evidence

- [`issue.md`](issue.md) — issue metadata and report summary.
- [`source-assets/issue-17-screenshot.png`](source-assets/issue-17-screenshot.png)
  — authenticated download of the original 1824×1115 GitHub attachment.
- GitHub issue comments were queried with pagination: none existed.
- PR #18 conversation comments, inline review comments, and reviews were all
  queried separately with pagination: none existed at investigation time.

## Reconstructed timeline

| Sequence | Evidence / event |
|---|---|
| 1 | Issue #11 introduced dynamic, device-aware model selection and estimated Transformers.js runtime memory as ONNX download size × 1.3. |
| 2 | Issue #13 fixed ORT asset resolution under the GitHub Pages sub-path. |
| 3 | Issue #15 made the chat surface persist beside the selector. |
| 4 | In the captured Safari session, SmolLM2 135M loaded and generated two coherent replies. This rules out those earlier backend-path and UI defects. |
| 5 | The user selected Qwen2.5 1.5B q4f16. The card classified its estimated ~1.5 GB footprint as fitting the CPU budget. |
| 6 | ORT attempted to construct the much larger session inside its WASM heap and terminated with `Aborted()`. |
| 7 | Issue #17 was filed on 2026-06-12 with the screenshot. |
| 8 | On 2026-07-12 the model tree, selector math, backend dispatch, upstream documentation, and related reports were investigated and the regression tests/fix were added. |

## Requirements and disposition

| Requirement | Disposition |
|---|---|
| Fix Qwen2.5 instruct loading failure | Fixed at the cause: CPU-only devices no longer offer Qwen2.5 1.5B when peak WASM memory is unsafe; capable WebGPU devices retain it. |
| Archive all issue evidence | Original attachment and issue metadata are stored in this directory. There were no issue comments or PR review artifacts to archive. |
| Reconstruct sequence and enumerate requirements | This document provides both. |
| Find root causes for every problem | Peak-memory under-estimation is the primary cause; unsafe WebGPU fallback and label-based size fallback were two code-wide variants of it and are also fixed. |
| Research online facts and existing components | Transformers.js, ONNX Runtime Web, the Hub model artifacts, WebLLM, and upstream failure reports were reviewed below. |
| Add diagnostics if root cause remains unknown | Not needed for the selector defect; existing `?debug=1` worker logging remains available and off by default. The improved fallback error is actionable rather than `Aborted()`. |
| Report an upstream issue when another project is at fault | No new upstream issue: the app incorrectly admitted an unsafe configuration. Existing upstream reports already document opaque large-model/OOM failures. |
| Apply the fix everywhere | The shared fit evaluator drives visibility, recommendation, auto-load, manual selection, and WebGPU fallback eligibility. |
| Reproduce with an automated test | Unit tests reproduce the incorrect CPU verdict for Qwen2.5 1.5B and verify its WebGPU verdict. |

## Root-cause analysis

### Why this is not a general Qwen or backend failure

The screenshot shows successful inference immediately before model switching.
The Qwen repository is tagged for Transformers.js and contains the expected
ONNX variants. Transformers.js explicitly demonstrates Qwen2.5 with its
text-generation pipeline. The failure is correlated with the 1.22 GB graph and
CPU/WASM execution, not architecture dispatch or prompting.

### Faulty memory model

Before the fix:

```text
runtime estimate = ONNX download bytes × 1.3
Qwen q4f16       = 1,221,878,940 × 1.3 ≈ 1.48 GiB
WASM budget      = 2.00 GiB
verdict          = fits/tight → load allowed
```

That estimate covers weights, activations and KV cache but treats the download
almost as the complete live allocation. ORT must deserialize the graph and
allocate session/initializer/arena memory inside the same WASM address space.
The corrected CPU estimate adds a conservative heap construction factor:

```text
WASM runtime estimate = download × 1.3 × 1.8 ≈ 2.66 GiB
verdict               = too large → no unsafe load
```

WebGPU retains the original factor because its main tensor allocations are GPU
buffers and do not compete solely inside the wasm32 heap.

### Unsafe fallback

The worker previously retried every failed WebGPU pipeline on WASM using the
same model/dtype. A model selected precisely because it fits the larger GPU
budget can exceed the CPU heap, turning a recoverable WebGPU error into an OOM
abort. The main thread now computes the exact CPU verdict and passes fallback
eligibility with the load request.

### Incorrect “smallest” fallback

The old fallback assumed `q4f16 < q4 < q8` by label. Actual repositories do not
guarantee that ordering: Qwen2.5 1.5B publishes q4f16 at 1,221,878,940 bytes,
q8 at 1,578,954,293 bytes, and q4 at 1,787,566,590 bytes. The fallback now sorts
available artifacts by measured bytes.

## Online research and alternatives

- [Transformers.js documentation](https://huggingface.co/docs/transformers.js/main/index)
  identifies WASM as the browser CPU backend, WebGPU as the accelerated path,
  and documents q8 as its typical WASM default. It also demonstrates quantized
  pipeline selection.
- [Transformers.js v3 announcement](https://huggingface.co/blog/transformersjs-v3)
  demonstrates `onnx-community/Qwen2.5-0.5B-Instruct` with q4 on WebGPU and
  explains that available dtypes are model-dependent.
- [ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
  shows WASM across Safari while WebGPU support is browser-dependent. This
  matches the screenshot's Safari + CPU combination.
- [Transformers.js issue #1024](https://github.com/huggingface/transformers.js/issues/1024)
  records opaque numeric/load failures for larger text-generation models; an
  upstream maintainer identifies out-of-memory as a likely cause. This is
  consistent evidence, not proof specific to this session.
- [Qwen2.5 1.5B ONNX repository](https://huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct/tree/main/onnx)
  is the authoritative artifact source. Its real sizes demonstrate why dtype
  labels cannot serve as a size ordering.
- **WebLLM/MLC** was considered as an alternative engine. It is well optimized
  for WebGPU LLMs but would not fix CPU-only Safari, would add a second model
  packaging ecosystem, and is unnecessary for correcting admission control.
- **Transformers.js / ORT remains appropriate** because it already supports
  Qwen2 and the existing multi-architecture catalog. The defect was local fit
  estimation, not missing framework support.

## Reproduction and verification

Automated minimum reproduction in `web/src/models/models.test.ts`:

1. Select the Qwen2.5 1.5B catalog entry.
2. Evaluate it with no WebGPU adapter and a 2 GiB WASM budget.
3. Assert the verdict is `too-large` (the old implementation returned `tight`).
4. Evaluate with a usable WebGPU adapter and assert q4f16 remains selectable.

Additional tests ensure the smallest real artifact is used when nothing fits.
The complete local test/quality commands are recorded in PR #18.
