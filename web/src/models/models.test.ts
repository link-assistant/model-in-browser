import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  getModelById,
  modelUrls,
  downloadBytes,
  formatPrompt,
  type ModelCatalogEntry,
} from './catalog';
import {
  estimateMemoryBudget,
  estimateRuntimeBytes,
  evaluateFit,
  formatBytes,
  formatCount,
  type DeviceCapabilities,
} from './device';
import { pickRecommended, evaluateCatalog } from './registry';

function makeCaps(over: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    deviceMemoryGb: null,
    cpuCores: 4,
    isMobile: false,
    hasWebGpu: false,
    storageQuotaBytes: null,
    storageUsageBytes: null,
    memoryBudgetBytes: 2 * 1024 * 1024 * 1024,
    ...over,
  };
}

describe('catalog', () => {
  it('contains only ungated llama-architecture models', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThan(0);
    for (const m of MODEL_CATALOG) {
      expect(m.architecture).toBe('llama');
      expect(m.parameters).toBeGreaterThan(0);
      expect(m.files.weights.bytes).toBeGreaterThan(0);
    }
  });

  it('is ordered smallest-first by parameter count', () => {
    for (let i = 1; i < MODEL_CATALOG.length; i++) {
      expect(MODEL_CATALOG[i].parameters).toBeGreaterThanOrEqual(
        MODEL_CATALOG[i - 1].parameters
      );
    }
  });

  it('looks up entries by id', () => {
    const first = MODEL_CATALOG[0];
    expect(getModelById(first.id)).toBe(first);
    expect(getModelById('does-not-exist')).toBeUndefined();
  });

  it('builds resolve URLs for the Hub', () => {
    const entry = getModelById('smollm2-135m-instruct')!;
    const urls = modelUrls(entry);
    expect(urls.modelUrl).toBe(
      'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors'
    );
    expect(urls.tokenizerUrl).toContain('tokenizer.json');
    expect(urls.configUrl).toContain('config.json');
  });

  it('sums download bytes across files', () => {
    const entry = MODEL_CATALOG[0];
    expect(downloadBytes(entry)).toBe(
      entry.files.weights.bytes +
        entry.files.tokenizer.bytes +
        entry.files.config.bytes
    );
  });

  it('formats prompts per template family', () => {
    const chatml = getModelById('smollm2-135m-instruct')!;
    const zephyr = getModelById('tinyllama-1.1b-chat')!;
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

  it('estimates F32 runtime footprint at ~4 bytes/param plus overhead', () => {
    const entry = MODEL_CATALOG[0];
    const bytes = estimateRuntimeBytes(entry);
    expect(bytes).toBeGreaterThan(entry.parameters * 4);
    expect(bytes).toBeLessThan(entry.parameters * 6);
  });

  it('classifies a tiny model as fitting and a huge one as too-large', () => {
    const caps = makeCaps({ memoryBudgetBytes: 2 * 1024 * 1024 * 1024 });
    const tiny = getModelById('smollm2-135m-instruct')!;
    const huge = getModelById('smollm2-1.7b-instruct')!;
    expect(evaluateFit(tiny, caps, downloadBytes(tiny)).level).toBe('fits');
    expect(evaluateFit(huge, caps, downloadBytes(huge)).level).toBe('too-large');
  });

  it('flags insufficient storage', () => {
    const entry = MODEL_CATALOG[0];
    const caps = makeCaps({
      storageQuotaBytes: 1000,
      storageUsageBytes: 0,
    });
    const fit = evaluateFit(entry, caps, downloadBytes(entry));
    expect(fit.insufficientStorage).toBe(true);
  });
});

describe('recommendation', () => {
  it('recommends the most-downloaded model that fits', () => {
    // Generous desktop budget: everything except the very largest fits.
    const caps = makeCaps({ memoryBudgetBytes: 3 * 1024 * 1024 * 1024 });
    const rec = pickRecommended(MODEL_CATALOG, caps);
    expect(rec).not.toBeNull();
    // Among fitting models, it must have the highest downloads of the fitters.
    const evaluatedList = evaluateCatalog(MODEL_CATALOG, caps);
    const fitters = evaluatedList.filter(
      (m) => m.fit.level !== 'too-large' && !m.fit.insufficientStorage
    );
    const maxDownloads = Math.max(
      ...fitters.map((m) => m.entry.popularity.downloads)
    );
    expect(rec!.popularity.downloads).toBe(maxDownloads);
  });

  it('falls back to the smallest model when nothing fits', () => {
    const caps = makeCaps({ memoryBudgetBytes: 1 }); // absurdly tiny
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
    // Budget where 135M fits comfortably but 360M is tight; 135M is also the
    // most-downloaded, so it should win regardless — use a budget where 360M is
    // more popular to isolate the fit-preference path.
    const tiny = getModelById('smollm2-135m-instruct')!;
    const mid = getModelById('smollm2-360m-instruct')!;
    const synthetic: ModelCatalogEntry[] = [
      { ...tiny, popularity: { downloads: 10, likes: 1 } },
      { ...mid, popularity: { downloads: 1000, likes: 1 } },
    ];
    // Budget: 135M comfortable, 360M tight (>80% of budget).
    const midRuntime = estimateRuntimeBytes(mid);
    const caps = makeCaps({ memoryBudgetBytes: midRuntime / 0.9 });
    const rec = pickRecommended(synthetic, caps);
    expect(rec!.id).toBe(tiny.id);
  });
});

describe('formatters', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(269_060_552)).toBe('257 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('formats counts', () => {
    expect(formatCount(340)).toBe('340');
    expect(formatCount(1_543_897)).toBe('1.5M');
    expect(formatCount(2_080)).toBe('2.1K');
  });
});
