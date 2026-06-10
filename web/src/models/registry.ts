/**
 * Model registry: combines the static catalog with live popularity data from
 * the HuggingFace Hub and device-fit evaluation, then picks the model to
 * recommend for the current device.
 *
 * The "recommended" model is the most popular one (by Hub downloads) that
 * actually fits the user's device — directly implementing the issue's
 * requirement to "use the most popular of them that will actually fit on the
 * actual device of the user".
 */

import {
  MODEL_CATALOG,
  downloadBytes,
  type ModelCatalogEntry,
} from './catalog';
import {
  evaluateFit,
  type DeviceCapabilities,
  type ModelFit,
} from './device';

export interface EvaluatedModel {
  entry: ModelCatalogEntry;
  fit: ModelFit;
  downloadBytes: number;
  /** True when this is the recommended model for the device. */
  recommended: boolean;
}

/**
 * Refresh popularity (downloads/likes) for catalog models from the live Hub
 * API. Returns a new array of entries; falls back to the static values on any
 * network/parse error so the app keeps working offline.
 */
export async function fetchLivePopularity(
  entries: ModelCatalogEntry[] = MODEL_CATALOG,
  signal?: AbortSignal
): Promise<ModelCatalogEntry[]> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        const url = `https://huggingface.co/api/models/${entry.repo}?expand=downloads&expand=likes`;
        const res = await fetch(url, { signal });
        if (!res.ok) return entry;
        const data = (await res.json()) as {
          downloads?: number;
          likes?: number;
        };
        if (
          typeof data.downloads !== 'number' &&
          typeof data.likes !== 'number'
        ) {
          return entry;
        }
        return {
          ...entry,
          popularity: {
            downloads: data.downloads ?? entry.popularity.downloads,
            likes: data.likes ?? entry.popularity.likes,
          },
        };
      } catch {
        return entry;
      }
    })
  );
  return results;
}

/**
 * Choose the recommended model: the most-downloaded catalog model that fits the
 * device (preferring a comfortable fit over a tight one). Falls back to the
 * smallest model when nothing fits cleanly, so the UI always has a default.
 */
export function pickRecommended(
  entries: ModelCatalogEntry[],
  caps: DeviceCapabilities
): ModelCatalogEntry | null {
  if (entries.length === 0) return null;

  const evaluated = entries.map((entry) => ({
    entry,
    fit: evaluateFit(entry, caps, downloadBytes(entry)),
  }));

  const runnable = evaluated.filter(
    (m) => m.fit.level !== 'too-large' && !m.fit.insufficientStorage
  );

  if (runnable.length > 0) {
    // Prefer comfortable fits over tight ones, then highest downloads.
    runnable.sort((a, b) => {
      const fitRank = (level: ModelFit['level']) => (level === 'fits' ? 0 : 1);
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
 * Evaluate every catalog model against the device and flag the recommended one.
 * Models are returned smallest-first (the catalog order).
 */
export function evaluateCatalog(
  entries: ModelCatalogEntry[],
  caps: DeviceCapabilities
): EvaluatedModel[] {
  const recommended = pickRecommended(entries, caps);
  return entries.map((entry) => {
    const dl = downloadBytes(entry);
    return {
      entry,
      fit: evaluateFit(entry, caps, dl),
      downloadBytes: dl,
      recommended: recommended?.id === entry.id,
    };
  });
}
