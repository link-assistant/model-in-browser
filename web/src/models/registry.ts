/**
 * Model registry: combines the catalog (static seed + live Hub data) with
 * device-fit evaluation, then picks the model to recommend for the current
 * device.
 *
 * The "recommended" model is the most popular one (by Hub downloads) that
 * actually fits the user's device at some quantization — directly implementing
 * the issue's requirement to "use the most popular of them that will actually
 * fit on the actual device of the user".
 *
 * Live Hub access (popularity refresh, per-dtype size refresh, and dynamic
 * discovery of new models) lives in `hub.ts`; this module is pure and
 * synchronous so it can be unit-tested without the network.
 */

import {
  type Dtype,
  type ModelCatalogEntry,
} from './catalog';
import {
  evaluateFit,
  pickBestDtype,
  type DeviceCapabilities,
  type ModelFit,
} from './device';

// Re-export the live Hub helpers so existing imports of `registry` keep working.
export {
  fetchLivePopularity,
  fetchLiveVariants,
  fetchLiveCatalogSizes,
  discoverModels,
} from './hub';

export interface EvaluatedModel {
  entry: ModelCatalogEntry;
  fit: ModelFit;
  /** The dtype chosen for this device (transformers engine), if any. */
  dtype?: Dtype;
  /** Download bytes for the chosen dtype/variant. */
  downloadBytes: number;
  /** True when this is the recommended model for the device. */
  recommended: boolean;
}

const fitRank = (level: ModelFit['level']): number =>
  level === 'fits' ? 0 : level === 'tight' ? 1 : 2;

/**
 * Choose the recommended model: the most-downloaded catalog model that fits the
 * device (preferring a comfortable fit over a tight one), evaluated at the best
 * quantization for the device. Falls back to the smallest model when nothing
 * fits cleanly, so the UI always has a default.
 */
export function pickRecommended(
  entries: ModelCatalogEntry[],
  caps: DeviceCapabilities
): ModelCatalogEntry | null {
  if (entries.length === 0) return null;

  const evaluated = entries.map((entry) => ({
    entry,
    fit: evaluateFit(entry, caps),
  }));

  const runnable = evaluated.filter(
    (m) => m.fit.level !== 'too-large' && !m.fit.insufficientStorage
  );

  if (runnable.length > 0) {
    // Prefer comfortable fits over tight ones, then highest downloads.
    runnable.sort((a, b) => {
      const byFit = fitRank(a.fit.level) - fitRank(b.fit.level);
      if (byFit !== 0) return byFit;
      return b.entry.popularity.downloads - a.entry.popularity.downloads;
    });
    return runnable[0].entry;
  }

  // Nothing fits — fall back to the smallest model by parameter count.
  return [...entries].sort((a, b) => a.parameters - b.parameters)[0];
}

/**
 * Evaluate every catalog model against the device (at its best dtype) and flag
 * the recommended one. Models are returned in catalog order (smallest-first).
 */
export function evaluateCatalog(
  entries: ModelCatalogEntry[],
  caps: DeviceCapabilities
): EvaluatedModel[] {
  const recommended = pickRecommended(entries, caps);
  return entries.map((entry) => {
    const dtype =
      entry.engine === 'transformers' ? pickBestDtype(entry, caps) : undefined;
    const fit = evaluateFit(entry, caps, dtype);
    return {
      entry,
      fit,
      dtype,
      downloadBytes: fit.downloadBytes,
      recommended: recommended?.id === entry.id,
    };
  });
}

/**
 * Merge discovered/live entries into a base catalog, de-duplicating by `id`
 * (live data wins) and keeping the result ordered smallest-first by parameters.
 */
export function mergeCatalog(
  base: ModelCatalogEntry[],
  extra: ModelCatalogEntry[]
): ModelCatalogEntry[] {
  const byId = new Map<string, ModelCatalogEntry>();
  for (const e of base) byId.set(e.id, e);
  for (const e of extra) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.parameters - b.parameters);
}
