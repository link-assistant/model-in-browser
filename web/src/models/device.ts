/**
 * Browser device capability detection and model-fit estimation.
 *
 * The goal is to decide, entirely client-side, which catalog models can run on
 * the current device. See docs/case-studies/issue-11 for the research behind
 * the heuristics and the browser-support caveats of each probe.
 *
 * Key facts that drive the math:
 * - The WASM engine loads weights as F32 (~4 bytes/parameter) and runs on the
 *   wasm32 backend, whose address space is capped at ~4 GiB. In practice a
 *   single contiguous allocation rarely exceeds ~2 GB, and mobile browsers
 *   reclaim memory far more aggressively.
 * - `navigator.deviceMemory` is a coarse, Chromium-only RAM bucket
 *   ({0.25,0.5,1,2,4,8,...} GiB); absent in Firefox/Safari/iOS.
 * - `navigator.hardwareConcurrency` is broadly supported (clamped to 2 on iOS,
 *   8 in WebKit) and is used only to size thread pools, not as a memory proxy.
 */

import type { ModelCatalogEntry } from './catalog';

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
  /** Storage quota available to this origin in bytes, or null. */
  storageQuotaBytes: number | null;
  /** Storage already used by this origin in bytes, or null. */
  storageUsageBytes: number | null;
  /**
   * Estimated upper bound (bytes) for the model's in-memory footprint that this
   * device can safely allocate in a single browser tab.
   */
  memoryBudgetBytes: number;
}

/** Heuristic mobile detection from the user-agent string. */
function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
}

/**
 * Estimate the runtime memory budget for a single tab.
 *
 * Starts from the wasm32 practical ceiling (~2 GB) and tightens it based on the
 * (optional) device-memory hint and mobile status. Deliberately conservative:
 * over-promising leads to OOM tab crashes mid-download, which is a far worse UX
 * than recommending a slightly smaller model.
 */
export function estimateMemoryBudget(
  deviceMemoryGb: number | null,
  isMobile: boolean
): number {
  // Practical single-allocation ceiling for wasm32 across desktop browsers.
  let budget = 2 * GB;

  if (deviceMemoryGb != null) {
    // Reserve memory for the OS, the browser, the page and other tabs: assume
    // roughly half of total RAM can go to a single model allocation.
    budget = Math.min(budget, deviceMemoryGb * GB * 0.5);
  }

  if (isMobile) {
    // Mobile browsers kill tabs well below the wasm32 ceiling.
    budget = Math.min(budget, 1 * GB);
  }

  // Never claim less than enough for the smallest model so the UI always has at
  // least one runnable option to recommend.
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

  const hasWebGpu =
    nav != null && 'gpu' in nav && (nav as Navigator & { gpu?: unknown }).gpu != null;

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
    storageQuotaBytes,
    storageUsageBytes,
    memoryBudgetBytes: estimateMemoryBudget(deviceMemoryGb, isMobile),
  };
}

/**
 * Estimate the in-memory footprint (bytes) of a model on the F32 WASM engine.
 *
 * Weights are 4 bytes/param; a ~30% overhead covers activations, the KV cache
 * and tokenizer/runtime structures for a short chat context.
 */
export function estimateRuntimeBytes(entry: ModelCatalogEntry): number {
  const F32_BYTES_PER_PARAM = 4;
  const OVERHEAD = 1.3;
  return Math.round(entry.parameters * F32_BYTES_PER_PARAM * OVERHEAD);
}

export type FitLevel = 'fits' | 'tight' | 'too-large';

export interface ModelFit {
  level: FitLevel;
  /** Estimated in-memory footprint in bytes. */
  runtimeBytes: number;
  /** Estimated runtime footprint as a fraction of the device memory budget. */
  budgetFraction: number;
  /** True when storage quota is known and too small for the download. */
  insufficientStorage: boolean;
  /** Human-readable reason shown in the UI. */
  reason: string;
}

/** Classify how well a model fits the detected device. */
export function evaluateFit(
  entry: ModelCatalogEntry,
  caps: DeviceCapabilities,
  downloadBytes: number
): ModelFit {
  const runtimeBytes = estimateRuntimeBytes(entry);
  const budgetFraction = runtimeBytes / caps.memoryBudgetBytes;

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
    insufficientStorage = free < downloadBytes * 1.1;
  }

  let reason: string;
  if (level === 'too-large') {
    reason = 'Needs more memory than this device can safely provide.';
  } else if (insufficientStorage) {
    reason = 'Not enough free storage to cache this model.';
  } else if (level === 'tight') {
    reason = 'Should run, but close to this device’s memory limit.';
  } else {
    reason = 'Comfortably fits this device.';
  }

  return { level, runtimeBytes, budgetFraction, insufficientStorage, reason };
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
