import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  getModelById,
  modelUrls,
  downloadBytes,
  formatPrompt,
  getVariant,
  DTYPE_ORDER,
  type ModelCatalogEntry,
} from './catalog';
import {
  estimateMemoryBudget,
  estimateGpuBudget,
  estimateRuntimeBytes,
  evaluateFit,
  evaluateFitForDtype,
  pickBestDtype,
  budgetFor,
  fitsDevice,
  formatBytes,
  formatCount,
  type DeviceCapabilities,
} from './device';
import {
  pickRecommended,
  evaluateCatalog,
  mergeCatalog,
} from './registry';

const GB = 1024 * 1024 * 1024;

function makeCaps(over: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    deviceMemoryGb: null,
    cpuCores: 4,
    isMobile: false,
    hasWebGpu: false,
    webGpuAdapter: false,
    storageQuotaBytes: null,
    storageUsageBytes: null,
    memoryBudgetBytes: 2 * GB,
    gpuBudgetBytes: 4 * GB,
    ...over,
  };
}

describe('catalog', () => {
  it('contains valid, ungated entries for both engines', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThan(0);
    let transformers = 0;
    let candle = 0;
    for (const m of MODEL_CATALOG) {
      expect(m.parameters).toBeGreaterThan(0);
      expect(m.id).toBeTruthy();
      expect(m.repo).toBeTruthy();
      if (m.engine === 'transformers') {
        transformers++;
        // Transformers models load quantized ONNX and can use WebGPU.
        expect(m.variants.length).toBeGreaterThan(0);
        expect(m.webgpu).toBe(true);
        for (const v of m.variants) expect(v.bytes).toBeGreaterThan(0);
      } else {
        candle++;
        // Candle models load F32 safetensors (no ONNX variants, no WebGPU).
        expect(m.files).toBeDefined();
        expect(m.files!.weights.bytes).toBeGreaterThan(0);
        expect(m.webgpu).toBe(false);
      }
    }
    // The catalog supports more than one architecture family.
    const archs = new Set(MODEL_CATALOG.map((m) => m.architecture));
    expect(archs.size).toBeGreaterThan(1);
    // Both engines are represented.
    expect(transformers).toBeGreaterThan(0);
    expect(candle).toBeGreaterThan(0);
  });

  it('leads with the smallest model so it is the safe default', () => {
    const smallest = Math.min(...MODEL_CATALOG.map((m) => m.parameters));
    expect(MODEL_CATALOG[0].parameters).toBe(smallest);
  });

  it('looks up entries by id', () => {
    const first = MODEL_CATALOG[0];
    expect(getModelById(first.id)).toBe(first);
    expect(getModelById('does-not-exist')).toBeUndefined();
  });

  it('builds resolve URLs for the Hub (candle entries)', () => {
    const entry = getModelById('smollm2-135m-candle')!;
    const urls = modelUrls(entry);
    expect(urls.modelUrl).toBe(
      'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors'
    );
    expect(urls.tokenizerUrl).toContain('tokenizer.json');
    expect(urls.configUrl).toContain('config.json');
  });

  it('throws when building safetensors URLs for a transformers entry', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    expect(() => modelUrls(entry)).toThrow();
  });

  it('lists the smallest variant first so the default download is minimal', () => {
    // `downloadBytes` defaults to variants[0], so it must be the smallest.
    for (const m of MODEL_CATALOG) {
      if (m.variants.length === 0) continue;
      const minBytes = Math.min(...m.variants.map((v) => v.bytes));
      expect(m.variants[0].bytes).toBe(minBytes);
    }
  });

  it('computes download bytes per dtype (transformers) and per file (candle)', () => {
    const t = getModelById('smollm2-135m-instruct')!;
    // Defaults to the first (smallest) variant.
    expect(downloadBytes(t)).toBe(t.variants[0].bytes);
    // Honours an explicit dtype.
    const q8 = getVariant(t, 'q8')!;
    expect(downloadBytes(t, 'q8')).toBe(q8.bytes);

    const c = getModelById('smollm2-135m-candle')!;
    expect(downloadBytes(c)).toBe(
      c.files!.weights.bytes + c.files!.tokenizer.bytes + c.files!.config.bytes
    );
  });

  it('formats prompts per template family (candle engine)', () => {
    const chatml = getModelById('smollm2-135m-candle')!;
    const zephyr: ModelCatalogEntry = { ...chatml, promptFormat: 'zephyr' };
    expect(formatPrompt(chatml, 'hi')).toContain('<|im_start|>user');
    expect(formatPrompt(zephyr, 'hi')).toContain('<|user|>');
  });
});

describe('device fit estimation', () => {
  it('tightens the memory budget for mobile and low-RAM devices', () => {
    const desktop = estimateMemoryBudget(null, false);
    const mobile = estimateMemoryBudget(null, true);
    const lowRam = estimateMemoryBudget(1, false);
    expect(desktop).toBeGreaterThan(mobile);
    expect(lowRam).toBeLessThan(desktop);
    // Always at least enough for the smallest model.
    expect(estimateMemoryBudget(0.25, true)).toBeGreaterThanOrEqual(
      700 * 1024 * 1024
    );
  });

  it('gives WebGPU a larger budget than the WASM/CPU path', () => {
    expect(estimateGpuBudget(null, false)).toBeGreaterThan(
      estimateMemoryBudget(null, false)
    );
    // Mobile still tightens the GPU budget relative to desktop.
    expect(estimateGpuBudget(null, true)).toBeLessThan(
      estimateGpuBudget(null, false)
    );
  });

  it('estimates candle F32 runtime at ~4 bytes/param plus overhead', () => {
    const entry = getModelById('smollm2-135m-candle')!;
    const bytes = estimateRuntimeBytes(entry);
    expect(bytes).toBeGreaterThan(entry.parameters * 4);
    expect(bytes).toBeLessThan(entry.parameters * 6);
  });

  it('estimates transformers runtime from the quantized download size', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    const q4 = estimateRuntimeBytes(entry, 'q4f16');
    const fp32 = estimateRuntimeBytes(entry, 'fp32');
    // 4-bit is much smaller in memory than 32-bit.
    expect(q4).toBeLessThan(fp32);
    expect(q4).toBeGreaterThan(downloadBytes(entry, 'q4f16'));
  });

  it('picks the highest-quality dtype that fits the device', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    // Generous desktop budget: full-precision fits.
    const big = pickBestDtype(entry, makeCaps({ memoryBudgetBytes: 4 * GB }));
    expect(big).toBe('fp32');
    // Tiny budget: only the most-compressed variant fits.
    const small = pickBestDtype(
      entry,
      makeCaps({ memoryBudgetBytes: 200 * 1024 * 1024 })
    );
    expect(small).toBe('q4f16');
  });

  it('uses the GPU budget when the model and device support WebGPU', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    const caps = makeCaps({
      webGpuAdapter: true,
      memoryBudgetBytes: 1 * GB,
      gpuBudgetBytes: 4 * GB,
    });
    expect(budgetFor(entry, caps)).toBe(4 * GB);
    expect(evaluateFitForDtype(entry, caps, 'q4f16').usesWebGpu).toBe(true);
  });

  it('classifies a tiny model as fitting and a huge one as too-large', () => {
    const caps = makeCaps({ memoryBudgetBytes: 2 * GB });
    const tiny = getModelById('smollm2-135m-instruct')!;
    // Phi-3.5 mini only ships q4f16 (~2.3 GB) — too big for a 2 GB WASM budget.
    const huge = getModelById('phi-3.5-mini-instruct')!;
    expect(evaluateFit(tiny, caps).level).toBe('fits');
    expect(evaluateFit(huge, caps).level).toBe('too-large');
  });

  it('flags insufficient storage', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    const caps = makeCaps({
      storageQuotaBytes: 1000,
      storageUsageBytes: 0,
    });
    const fit = evaluateFit(entry, caps);
    expect(fit.insufficientStorage).toBe(true);
  });

  it('treats fits/tight as runnable and too-large or no-storage as not', () => {
    const tiny = getModelById('smollm2-135m-instruct')!;
    // Comfortable fit → runnable (shown by default).
    expect(fitsDevice(evaluateFit(tiny, makeCaps({ memoryBudgetBytes: 2 * GB })))).toBe(
      true
    );
    // Too-large → not runnable (hidden by default).
    const huge = getModelById('phi-3.5-mini-instruct')!;
    expect(fitsDevice(evaluateFit(huge, makeCaps({ memoryBudgetBytes: 2 * GB })))).toBe(
      false
    );
    // Fits memory but no storage → not runnable.
    const noStorage = evaluateFit(
      tiny,
      makeCaps({ storageQuotaBytes: 1000, storageUsageBytes: 0 })
    );
    expect(noStorage.level).not.toBe('too-large');
    expect(fitsDevice(noStorage)).toBe(false);
  });
});

describe('recommendation', () => {
  it('recommends the most-downloaded model that fits', () => {
    // Generous desktop budget: everything except the very largest fits.
    const caps = makeCaps({ memoryBudgetBytes: 3 * GB });
    const rec = pickRecommended(MODEL_CATALOG, caps);
    expect(rec).not.toBeNull();
    // Among comfortably-fitting models, it must have the highest downloads.
    const evaluatedList = evaluateCatalog(MODEL_CATALOG, caps);
    const fitters = evaluatedList.filter((m) => m.fit.level === 'fits');
    const maxDownloads = Math.max(
      ...fitters.map((m) => m.entry.popularity.downloads)
    );
    expect(rec!.popularity.downloads).toBe(maxDownloads);
  });

  it('falls back to the smallest model when nothing fits', () => {
    const caps = makeCaps({ memoryBudgetBytes: 1, gpuBudgetBytes: 1 });
    const rec = pickRecommended(MODEL_CATALOG, caps);
    const smallest = [...MODEL_CATALOG].sort(
      (a, b) => a.parameters - b.parameters
    )[0];
    expect(rec!.id).toBe(smallest.id);
  });

  it('marks exactly one model as recommended in the evaluated catalog', () => {
    const caps = makeCaps();
    const list = evaluateCatalog(MODEL_CATALOG, caps);
    expect(list.filter((m) => m.recommended).length).toBe(1);
  });

  it('prefers a comfortable fit over a tight one', () => {
    const tiny = getModelById('smollm2-135m-instruct')!;
    const mid = getModelById('smollm2-360m-instruct')!;
    const synthetic: ModelCatalogEntry[] = [
      { ...tiny, popularity: { downloads: 10, likes: 1 } },
      { ...mid, popularity: { downloads: 1000, likes: 1 } },
    ];
    // Budget where the small model fits comfortably but the mid one is only
    // tight at its best dtype, so the comfortable fit must win despite fewer
    // downloads.
    const midBest = estimateRuntimeBytes(mid, 'q4f16');
    const caps = makeCaps({ memoryBudgetBytes: midBest / 0.9 });
    const rec = pickRecommended(synthetic, caps);
    expect(rec!.id).toBe(tiny.id);
  });

  it('evaluates each model at its device-specific dtype', () => {
    const caps = makeCaps({ memoryBudgetBytes: 3 * GB });
    const list = evaluateCatalog(MODEL_CATALOG, caps);
    for (const m of list) {
      if (m.entry.engine === 'transformers') {
        expect(m.dtype).toBeDefined();
        expect(DTYPE_ORDER).toContain(m.dtype);
        expect(m.downloadBytes).toBe(downloadBytes(m.entry, m.dtype));
      } else {
        expect(m.dtype).toBeUndefined();
      }
    }
  });
});

describe('catalog merge', () => {
  it('de-duplicates by id with live data winning and keeps size order', () => {
    const base = MODEL_CATALOG;
    const tiny = getModelById('smollm2-135m-instruct')!;
    const updated: ModelCatalogEntry = {
      ...tiny,
      popularity: { downloads: 9_999_999, likes: 1 },
    };
    const extra: ModelCatalogEntry = {
      ...tiny,
      id: 'brand-new-model',
      name: 'Brand New Model',
      parameters: 50_000_000,
    };
    const merged = mergeCatalog(base, [updated, extra]);
    // Updated entry replaced the base one (no duplicate id).
    expect(merged.filter((m) => m.id === tiny.id).length).toBe(1);
    expect(getModelById(tiny.id, merged)!.popularity.downloads).toBe(9_999_999);
    // New entry was added.
    expect(getModelById('brand-new-model', merged)).toBeDefined();
    // Still smallest-first.
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].parameters).toBeGreaterThanOrEqual(
        merged[i - 1].parameters
      );
    }
  });

  it('accepts dynamically-discovered models of any (new) architecture', () => {
    // The catalog is fully dynamic: a model with an architecture the code has
    // never heard of must still merge in (architecture is display-only).
    const tiny = getModelById('smollm2-135m-instruct')!;
    const discovered: ModelCatalogEntry = {
      ...tiny,
      id: 'brand-new-arch-model',
      name: 'Some Brand New Arch Model',
      // An architecture string that is NOT in the known union.
      architecture: 'mamba-ssm',
      parameters: 60_000_000,
    };
    const merged = mergeCatalog(MODEL_CATALOG, [discovered]);
    const found = getModelById('brand-new-arch-model', merged);
    expect(found).toBeDefined();
    expect(found!.architecture).toBe('mamba-ssm');
    // It is evaluated for fit just like any other model.
    const caps = makeCaps({ memoryBudgetBytes: 2 * GB });
    const list = evaluateCatalog(merged, caps);
    expect(list.some((m) => m.entry.id === 'brand-new-arch-model')).toBe(true);
  });
});

describe('formatters', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(269_060_552)).toBe('257 MB');
    expect(formatBytes(2 * GB)).toBe('2.0 GB');
  });

  it('formats counts', () => {
    expect(formatCount(340)).toBe('340');
    expect(formatCount(1_543_897)).toBe('1.5M');
    expect(formatCount(2_080)).toBe('2.1K');
  });
});
