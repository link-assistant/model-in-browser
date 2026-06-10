/**
 * Browser device capability detection and model-fit estimation.
 *
 * The goal is to decide, entirely client-side, which catalog models — and at
 * which quantization — can run on the current device. See
 * docs/case-studies/issue-11 for the research behind the heuristics and the
 * browser-support caveats of each probe.
 *
 * Two execution paths drive the memory math:
 * - **WebGPU** (transformers engine, `navigator.gpu`): weights live in GPU
 *   buffers, so the wasm32 4 GiB address-space ceiling does not apply. The
 *   budget is larger and bounded by (V)RAM instead.
 * - **WASM / CPU** (transformers WASM backend, or the candle engine): bounded by
 *   the wasm32 ~4 GiB address space; a single allocation rarely exceeds ~2 GB,
 *   and mobile browsers reclaim memory far more aggressively.
 *
 * Crucially, fit is evaluated **per quantization variant**: a model that is "too
 * large" at fp32 often "fits" comfortably at q4, which is the whole point of
 * supporting quantized weights.
 */

import {
  downloadBytes,
  DTYPE_ORDER,
  type Dtype,
  type ModelCatalogEntry,
} from './catalog';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface DeviceCapabilities {
  /** `navigator.deviceMemory` in GB, or null when unavailable. */
  deviceMemoryGb: number | null;
  /** Logical CPU cores (`navigator.hardwareConcurrency`), or null. */
  cpuCores: number | null;
  /** Whether the user agent looks like a phone/tablet. */
  isMobile: boolean;
  /** Whether WebGPU (`navigator.gpu`) is exposed (not necessarily usable). */
  hasWebGpu: boolean;
  /** Whether a WebGPU adapter was actually acquired (usable acceleration). */
  webGpuAdapter: boolean;
  /** Storage quota available to this origin in bytes, or null. */
  storageQuotaBytes: number | null;
  /** Storage already used by this origin in bytes, or null. */
  storageUsageBytes: number | null;
  /**
   * Estimated upper bound (bytes) for a model's in-memory footprint on the
   * **WASM/CPU** path (bounded by the wasm32 address space).
   */
  memoryBudgetBytes: number;
  /**
   * Estimated upper bound (bytes) for a model's footprint on the **WebGPU**
   * path (bounded by RAM/VRAM, not the wasm32 ceiling).
   */
  gpuBudgetBytes: number;
}

/** Heuristic mobile detection from the user-agent string. */
function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
}

/**
 * Estimate the WASM/CPU runtime memory budget for a single tab.
 *
 * Starts from the wasm32 practical ceiling (~2 GB) and tightens it based on the
 * (optional) device-memory hint and mobile status. Deliberately conservative:
 * over-promising leads to OOM tab crashes mid-download.
 */
export function estimateMemoryBudget(
  deviceMemoryGb: number | null,
  isMobile: boolean
): number {
  // Practical single-allocation ceiling for wasm32 across desktop browsers.
  let budget = 2 * GB;

  if (deviceMemoryGb != null) {
    // Reserve memory for the OS, browser, page and other tabs.
    budget = Math.min(budget, deviceMemoryGb * GB * 0.5);
  }

  if (isMobile) {
    // Mobile browsers kill tabs well below the wasm32 ceiling.
    budget = Math.min(budget, 1 * GB);
  }

  // Never claim less than enough for the smallest model.
  return Math.max(budget, 700 * MB);
}

/**
 * Estimate the WebGPU memory budget. WebGPU stores weights in GPU buffers, so
 * the wasm32 ceiling does not apply; the limit is (V)RAM. We still stay
 * conservative because integrated GPUs share system RAM.
 */
export function estimateGpuBudget(
  deviceMemoryGb: number | null,
  isMobile: boolean
): number {
  // Desktop discrete/integrated GPUs comfortably handle a few GB.
  let budget = 4 * GB;

  if (deviceMemoryGb != null) {
    // Integrated GPUs share system RAM; allow up to ~60% of it.
    budget = Math.min(budget, deviceMemoryGb * GB * 0.6);
  }

  if (isMobile) {
    // Mobile GPUs and memory pressure are far tighter.
    budget = Math.min(budget, 1.5 * GB);
  }

  return Math.max(budget, 700 * MB);
}

/** Probe the current browser for device capabilities. */
export async function detectDeviceCapabilities(): Promise<DeviceCapabilities> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  // `deviceMemory` is non-standard and Chromium-only.
  const deviceMemoryGb =
    nav && typeof (nav as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
      ? (nav as Navigator & { deviceMemory?: number }).deviceMemory ?? null
      : null;

  const cpuCores =
    nav && typeof nav.hardwareConcurrency === 'number'
      ? nav.hardwareConcurrency
      : null;

  const isMobile = detectMobile();

  const gpu =
    nav != null && 'gpu' in nav
      ? (nav as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
      : undefined;
  const hasWebGpu = gpu != null;

  // Actually try to acquire an adapter — `navigator.gpu` can exist without a
  // usable adapter (e.g. blocklisted GPU, headless CI).
  let webGpuAdapter = false;
  if (gpu?.requestAdapter) {
    try {
      const adapter = await gpu.requestAdapter();
      webGpuAdapter = adapter != null;
    } catch {
      webGpuAdapter = false;
    }
  }

  let storageQuotaBytes: number | null = null;
  let storageUsageBytes: number | null = null;
  if (nav?.storage?.estimate) {
    try {
      const estimate = await nav.storage.estimate();
      storageQuotaBytes = estimate.quota ?? null;
      storageUsageBytes = estimate.usage ?? null;
    } catch {
      // Storage estimation can throw in private-browsing contexts; ignore.
    }
  }

  return {
    deviceMemoryGb,
    cpuCores,
    isMobile,
    hasWebGpu,
    webGpuAdapter,
    storageQuotaBytes,
    storageUsageBytes,
    memoryBudgetBytes: estimateMemoryBudget(deviceMemoryGb, isMobile),
    gpuBudgetBytes: estimateGpuBudget(deviceMemoryGb, isMobile),
  };
}

/**
 * The memory budget that applies to a given model on this device: the GPU
 * budget when the model can use WebGPU and the device has a usable adapter,
 * otherwise the WASM/CPU budget.
 */
export function budgetFor(
  entry: ModelCatalogEntry,
  caps: DeviceCapabilities
): number {
  const useGpu = entry.webgpu && caps.webGpuAdapter;
  return useGpu ? caps.gpuBudgetBytes : caps.memoryBudgetBytes;
}

/**
 * Estimate the in-memory footprint (bytes) of a model at a given quantization.
 *
 * For the transformers engine we use the actual ONNX download size as the
 * dominant term (quantized weights are kept roughly as-is in memory) plus a
 * ~30% overhead for activations, the KV cache and runtime structures.
 *
 * For the candle engine, weights are F32 (~4 bytes/param) plus overhead.
 */
export function estimateRuntimeBytes(
  entry: ModelCatalogEntry,
  dtype?: Dtype
): number {
  const OVERHEAD = 1.3;
  if (entry.engine === 'candle') {
    return Math.round(entry.parameters * 4 * OVERHEAD);
  }
  const dl = downloadBytes(entry, dtype);
  return Math.round(dl * OVERHEAD);
}

export type FitLevel = 'fits' | 'tight' | 'too-large';

export interface ModelFit {
  level: FitLevel;
  /** The dtype this fit was evaluated for (transformers engine). */
  dtype?: Dtype;
  /** Estimated in-memory footprint in bytes. */
  runtimeBytes: number;
  /** Download bytes for the chosen dtype. */
  downloadBytes: number;
  /** Estimated runtime footprint as a fraction of the applicable budget. */
  budgetFraction: number;
  /** Whether this fit assumes WebGPU acceleration. */
  usesWebGpu: boolean;
  /** True when storage quota is known and too small for the download. */
  insufficientStorage: boolean;
  /** Human-readable reason shown in the UI. */
  reason: string;
}

/** Classify how well a specific dtype of a model fits the detected device. */
export function evaluateFitForDtype(
  entry: ModelCatalogEntry,
  caps: DeviceCapabilities,
  dtype?: Dtype
): ModelFit {
  const budget = budgetFor(entry, caps);
  const usesWebGpu = entry.webgpu && caps.webGpuAdapter;
  const runtimeBytes = estimateRuntimeBytes(entry, dtype);
  const dlBytes = downloadBytes(entry, dtype);
  const budgetFraction = runtimeBytes / budget;

  let level: FitLevel;
  if (budgetFraction <= 0.8) {
    level = 'fits';
  } else if (budgetFraction <= 1.0) {
    level = 'tight';
  } else {
    level = 'too-large';
  }

  // Storage gate: need room for the download plus headroom.
  let insufficientStorage = false;
  if (caps.storageQuotaBytes != null && caps.storageUsageBytes != null) {
    const free = caps.storageQuotaBytes - caps.storageUsageBytes;
    insufficientStorage = free < dlBytes * 1.1;
  }

  let reason: string;
  if (level === 'too-large') {
    reason = 'Needs more memory than this device can safely provide.';
  } else if (insufficientStorage) {
    reason = 'Not enough free storage to cache this model.';
  } else if (level === 'tight') {
    reason = `Should run${usesWebGpu ? ' on WebGPU' : ''}, but close to this device’s limit.`;
  } else {
    reason = usesWebGpu
      ? 'Comfortably fits with WebGPU acceleration.'
      : 'Comfortably fits this device.';
  }

  return {
    level,
    dtype,
    runtimeBytes,
    downloadBytes: dlBytes,
    budgetFraction,
    usesWebGpu,
    insufficientStorage,
    reason,
  };
}

/**
 * Pick the best dtype for a model on this device: the highest-quality (largest)
 * quantization that still fits comfortably; falls back to the smallest variant
 * so the UI can always show something (even if marked too-large).
 *
 * Quality order is the reverse of size order: fp32 > fp16 > q8 > q4 > q4f16.
 */
export function pickBestDtype(
  entry: ModelCatalogEntry,
  caps: DeviceCapabilities
): Dtype | undefined {
  if (entry.engine !== 'transformers' || entry.variants.length === 0) {
    return undefined;
  }
  const available = entry.variants.map((v) => v.dtype);
  // Highest quality first.
  const byQuality = [...DTYPE_ORDER].reverse().filter((d) => available.includes(d));

  // Prefer the highest-quality dtype that "fits"; else the highest that is at
  // most "tight"; else the smallest variant.
  let tight: Dtype | undefined;
  for (const d of byQuality) {
    const fit = evaluateFitForDtype(entry, caps, d);
    if (fit.insufficientStorage) continue;
    if (fit.level === 'fits') return d;
    if (fit.level === 'tight' && tight === undefined) tight = d;
  }
  if (tight) return tight;

  // Nothing fits — return the smallest (most compressed) variant.
  const smallest = [...DTYPE_ORDER].filter((d) => available.includes(d));
  return smallest[0] ?? available[0];
}

/**
 * Evaluate a model on this device using its best dtype (transformers) or its
 * single F32 footprint (candle).
 */
export function evaluateFit(
  entry: ModelCatalogEntry,
  caps: DeviceCapabilities,
  dtype?: Dtype
): ModelFit {
  const chosen =
    dtype ?? (entry.engine === 'transformers' ? pickBestDtype(entry, caps) : undefined);
  return evaluateFitForDtype(entry, caps, chosen);
}

/**
 * Whether a model can actually run on this device at its chosen quantization: it
 * must not exceed the memory budget (`too-large`) and there must be enough free
 * storage to cache the download. `tight` still counts as runnable. This is the
 * predicate the UI uses to decide which models to show by default and which to
 * hide behind the "show models that don't fit" toggle.
 */
export function fitsDevice(fit: ModelFit): boolean {
  return fit.level !== 'too-large' && !fit.insufficientStorage;
}

/** Format a byte count as a compact human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Format a large integer with thousands separators (e.g. download counts). */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
