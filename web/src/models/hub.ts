/**
 * Live HuggingFace Hub client — makes the model catalog **dynamic**.
 *
 * The app ships a curated seed catalog (`catalog.ts`) so it works offline and in
 * CI, but at runtime it augments and refreshes that seed directly from the Hub:
 *
 * 1. `fetchLivePopularity` — refresh downloads/likes for the seed models.
 * 2. `fetchLiveVariants`   — recompute per-dtype ONNX sizes from the file tree.
 * 3. `discoverModels`      — query the Hub for the most popular Transformers.js
 *    text-generation models and turn them into catalog entries on the fly.
 *
 * Every call degrades gracefully: any network/parse error leaves the seed
 * values untouched so the UI keeps working.
 */

import {
  type Architecture,
  type Dtype,
  type DtypeVariant,
  type ModelCatalogEntry,
  MODEL_CATALOG,
} from './catalog';

const HUB = 'https://huggingface.co';

/** ONNX filename → our Dtype. Mirrors Transformers.js `dtype` resolution. */
const DTYPE_BY_FILE: Record<string, Dtype> = {
  'model.onnx': 'fp32',
  'model_fp16.onnx': 'fp16',
  'model_q8.onnx': 'q8',
  'model_quantized.onnx': 'q8',
  'model_int8.onnx': 'q8',
  'model_q4.onnx': 'q4',
  'model_q4f16.onnx': 'q4f16',
};

interface HubTreeFile {
  path: string;
  size?: number;
}

interface HubModelInfo {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  config?: { model_type?: string; architectures?: string[] };
  safetensors?: { total?: number };
}

/**
 * Refresh popularity (downloads/likes) for catalog models from the live Hub.
 * Returns a new array; falls back to the static values on any error.
 */
export async function fetchLivePopularity(
  entries: ModelCatalogEntry[] = MODEL_CATALOG,
  signal?: AbortSignal
): Promise<ModelCatalogEntry[]> {
  // De-duplicate repos (e.g. the candle + transformers SmolLM2-135M share one).
  const byRepo = new Map<string, { downloads?: number; likes?: number }>();
  await Promise.all(
    [...new Set(entries.map((e) => e.repo))].map(async (repo) => {
      try {
        const url = `${HUB}/api/models/${repo}?expand=downloads&expand=likes`;
        const res = await fetch(url, { signal });
        if (!res.ok) return;
        const data = (await res.json()) as HubModelInfo;
        if (typeof data.downloads === 'number' || typeof data.likes === 'number') {
          byRepo.set(repo, { downloads: data.downloads, likes: data.likes });
        }
      } catch {
        /* keep static */
      }
    })
  );

  return entries.map((entry) => {
    const live = byRepo.get(entry.repo);
    if (!live) return entry;
    return {
      ...entry,
      popularity: {
        downloads: live.downloads ?? entry.popularity.downloads,
        likes: live.likes ?? entry.popularity.likes,
      },
    };
  });
}

/** Sum `model_{dtype}.onnx` and its external `model_{dtype}.onnx_data` sibling. */
function combineVariantSizes(files: HubTreeFile[]): DtypeVariant[] {
  const sizes = new Map<string, number>();
  for (const f of files) {
    const name = f.path.split('/').pop() ?? f.path;
    sizes.set(name, (sizes.get(name) ?? 0) + (f.size ?? 0));
  }
  const variants: DtypeVariant[] = [];
  for (const [file, dtype] of Object.entries(DTYPE_BY_FILE)) {
    const onnx = sizes.get(file);
    if (onnx == null) continue;
    const data = sizes.get(`${file}_data`) ?? 0;
    const total = onnx + data;
    if (total <= 0) continue;
    // Prefer model_quantized/int8 only if a dedicated q8 file is absent.
    if (dtype === 'q8' && variants.some((v) => v.dtype === 'q8')) continue;
    variants.push({ dtype, bytes: total });
  }
  // Smallest-first.
  return variants.sort((a, b) => a.bytes - b.bytes);
}

/**
 * Recompute a model's quantization variants from the live Hub file tree. Returns
 * the entry unchanged on any error or if the repo exposes no ONNX files.
 */
export async function fetchLiveVariants(
  entry: ModelCatalogEntry,
  signal?: AbortSignal
): Promise<ModelCatalogEntry> {
  if (entry.engine !== 'transformers') return entry;
  try {
    const url = `${HUB}/api/models/${entry.repo}/tree/${entry.revision}/onnx?recursive=true`;
    const res = await fetch(url, { signal });
    if (!res.ok) return entry;
    const files = (await res.json()) as HubTreeFile[];
    const variants = combineVariantSizes(files);
    if (variants.length === 0) return entry;
    return { ...entry, variants };
  } catch {
    return entry;
  }
}

/** Refresh variants for every transformers entry (best-effort, parallel). */
export async function fetchLiveCatalogSizes(
  entries: ModelCatalogEntry[] = MODEL_CATALOG,
  signal?: AbortSignal
): Promise<ModelCatalogEntry[]> {
  return Promise.all(entries.map((e) => fetchLiveVariants(e, signal)));
}

/** Map a Hub `model_type`/architectures string to our Architecture union. */
function mapArchitecture(info: HubModelInfo): Architecture | null {
  const t = (
    info.config?.model_type ||
    info.config?.architectures?.[0] ||
    ''
  ).toLowerCase();
  if (t.includes('qwen2')) return 'qwen2';
  if (t.includes('phi3') || t.includes('phi')) return 'phi3';
  if (t.includes('gemma')) return 'gemma';
  if (t.includes('llama')) return 'llama';
  return null;
}

function titleFromRepo(repo: string): string {
  return repo.split('/').pop() ?? repo;
}

function idFromRepo(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Discover the most popular Transformers.js text-generation models on the Hub
 * and turn them into catalog entries. Best-effort: returns whatever it could
 * build, skipping models without a supported architecture or usable ONNX files.
 *
 * @param limit  How many Hub results to consider (kept small to bound requests).
 * @param exclude Repos already present in the seed (skipped to avoid dupes).
 */
export async function discoverModels(
  limit = 8,
  exclude: Set<string> = new Set(MODEL_CATALOG.map((m) => m.repo)),
  signal?: AbortSignal
): Promise<ModelCatalogEntry[]> {
  let list: { id: string; downloads?: number; likes?: number }[] = [];
  try {
    const url =
      `${HUB}/api/models?filter=transformers.js&pipeline_tag=text-generation` +
      `&sort=downloads&direction=-1&limit=${limit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    list = (await res.json()) as typeof list;
  } catch {
    return [];
  }

  const candidates = list.filter((m) => m.id && !exclude.has(m.id));

  const built = await Promise.all(
    candidates.map(async (m) => {
      try {
        const [infoRes, treeRes] = await Promise.all([
          fetch(
            `${HUB}/api/models/${m.id}?expand=downloads&expand=likes&expand=config&expand=safetensors`,
            { signal }
          ),
          fetch(`${HUB}/api/models/${m.id}/tree/main/onnx?recursive=true`, {
            signal,
          }),
        ]);
        if (!infoRes.ok || !treeRes.ok) return null;
        const info = (await infoRes.json()) as HubModelInfo;
        const files = (await treeRes.json()) as HubTreeFile[];

        const architecture = mapArchitecture(info);
        if (!architecture) return null;

        const variants = combineVariantSizes(files);
        if (variants.length === 0) return null;

        // Params from safetensors metadata, or estimated from the fp32 ONNX.
        const fp32 = variants.find((v) => v.dtype === 'fp32');
        const parameters =
          info.safetensors?.total ??
          (fp32 ? Math.round(fp32.bytes / 4) : variants[variants.length - 1].bytes);

        const entry: ModelCatalogEntry = {
          id: idFromRepo(m.id),
          name: titleFromRepo(m.id),
          repo: m.id,
          revision: 'main',
          engine: 'transformers',
          architecture,
          parameters,
          webgpu: true,
          variants,
          description: `Discovered from the HuggingFace Hub — ${architecture} architecture, Transformers.js compatible.`,
          popularity: {
            downloads: info.downloads ?? m.downloads ?? 0,
            likes: info.likes ?? m.likes ?? 0,
          },
        };
        return entry;
      } catch {
        return null;
      }
    })
  );

  return built.filter((e): e is ModelCatalogEntry => e != null);
}
