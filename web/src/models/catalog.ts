/**
 * Curated seed catalog of small language models that run client-side in the
 * browser. The app combines this static seed with **live data from the
 * HuggingFace Hub** (see `hub.ts`) so the catalog stays fresh and dynamic; the
 * seed guarantees the app works offline and in CI.
 *
 * Two inference engines are supported (see `worker.ts`):
 *
 * - `transformers` — Hugging Face Transformers.js (ONNX Runtime Web). This is
 *   the default engine. It runs on **WebGPU** when available (with an automatic
 *   WASM fallback), supports many architectures (Llama, Qwen2, Phi-3, Gemma)
 *   and **quantized weights** (q4 / q4f16 / q8 / fp16 / fp32), letting larger
 *   models fit on phones.
 * - `candle` — the project's original Rust/candle WebAssembly engine. CPU-only,
 *   loads F32 safetensors. Kept available for the SmolLM2 models so the
 *   pure-Rust path is preserved.
 *
 * Parameter counts and ONNX file sizes below were verified against the live
 * HuggingFace API (`/api/models/{id}` and `/api/models/{id}/tree/main/onnx`) on
 * 2026-06-10. `popularity` and per-dtype `bytes` are refreshed from the live
 * Hub at runtime when the network allows.
 */

/** Inference engines available in the app. */
export type Engine = 'transformers' | 'candle';

/**
 * Model architecture family. The seed catalog uses well-known families
 * (`llama`, `smollm2`, `qwen2`, `phi3`, `gemma`), but the catalog is **fully
 * dynamic**: models discovered live from the Hub may carry any architecture
 * string (e.g. a freshly published `model_type`), so this is an open string
 * type rather than a closed union — new architectures show up with no code
 * change. The architecture is metadata for display/grouping only; Transformers.js
 * auto-detects the real architecture from the repo config at load time.
 */
export type Architecture = string;

/** Architecture families the seed catalog ships with, used for display hints. */
export type KnownArchitecture = 'llama' | 'smollm2' | 'qwen2' | 'phi3' | 'gemma';

/**
 * Quantization data types, ordered from smallest (most compressed) to largest.
 * These map directly to Transformers.js `dtype` values and to the
 * `onnx/model_{dtype}.onnx` files on the Hub.
 */
export type Dtype = 'q4f16' | 'q4' | 'q8' | 'fp16' | 'fp32';

/** Human-friendly labels for each quantization. */
export const DTYPE_LABEL: Record<Dtype, string> = {
  q4f16: '4-bit (q4f16)',
  q4: '4-bit (q4)',
  q8: '8-bit (q8)',
  fp16: '16-bit (fp16)',
  fp32: '32-bit (fp32)',
};

/** Smallest-to-largest preference order used when auto-selecting a dtype. */
export const DTYPE_ORDER: Dtype[] = ['q4f16', 'q4', 'q8', 'fp16', 'fp32'];

/** Chat prompt template families used by the candle engine (manual templating). */
export type PromptFormat = 'chatml' | 'zephyr';

export interface ModelFile {
  /** Filename relative to the repo root on the Hub. */
  name: string;
  /** Size in bytes (the weights file dominates the download). */
  bytes: number;
}

/** A single quantization variant of a model and its total download size. */
export interface DtypeVariant {
  dtype: Dtype;
  /** Total download bytes for this variant (onnx graph + external data). */
  bytes: number;
}

export interface ModelCatalogEntry {
  /** Stable identifier used in the UI and persisted to localStorage. */
  id: string;
  /** Human-friendly display name. */
  name: string;
  /** HuggingFace repo id, e.g. `HuggingFaceTB/SmolLM2-135M-Instruct`. */
  repo: string;
  /** Branch/revision to download from. */
  revision: string;
  /** Engine that loads this model. */
  engine: Engine;
  /** Architecture family. */
  architecture: Architecture;
  /** Total parameter count. */
  parameters: number;
  /**
   * Available quantization variants (transformers engine). Ordered from
   * smallest to largest. Empty for candle entries.
   */
  variants: DtypeVariant[];
  /** Whether the model can use WebGPU acceleration (true for ONNX/transformers). */
  webgpu: boolean;
  /** Prompt template family — only used by the candle engine. */
  promptFormat?: PromptFormat;
  /** Safetensors files — only present for candle entries. */
  files?: {
    weights: ModelFile;
    tokenizer: ModelFile;
    config: ModelFile;
  };
  /** Short description shown in the selector. */
  description: string;
  /** Popularity (refreshed live from the Hub when possible). */
  popularity: {
    downloads: number;
    likes: number;
  };
}

/** Base URL for resolving a file from a HuggingFace repo. */
export function fileUrl(entry: ModelCatalogEntry, fileName: string): string {
  return `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${fileName}`;
}

/**
 * Convenience accessors for the three safetensors URLs the candle worker needs.
 * Only valid for candle entries (those with a `files` block).
 */
export function modelUrls(entry: ModelCatalogEntry): {
  modelUrl: string;
  tokenizerUrl: string;
  configUrl: string;
} {
  if (!entry.files) {
    throw new Error(`Model ${entry.id} has no safetensors files (engine=${entry.engine})`);
  }
  return {
    modelUrl: fileUrl(entry, entry.files.weights.name),
    tokenizerUrl: fileUrl(entry, entry.files.tokenizer.name),
    configUrl: fileUrl(entry, entry.files.config.name),
  };
}

/** Look up a variant by dtype, or undefined if the model has no such variant. */
export function getVariant(
  entry: ModelCatalogEntry,
  dtype: Dtype
): DtypeVariant | undefined {
  return entry.variants.find((v) => v.dtype === dtype);
}

/**
 * Total bytes downloaded when loading a model at a given dtype. For candle
 * entries the dtype is ignored and the safetensors total is used.
 */
export function downloadBytes(entry: ModelCatalogEntry, dtype?: Dtype): number {
  if (entry.engine === 'candle' && entry.files) {
    return (
      entry.files.weights.bytes +
      entry.files.tokenizer.bytes +
      entry.files.config.bytes
    );
  }
  if (entry.variants.length === 0) return 0;
  const variant = (dtype && getVariant(entry, dtype)) || entry.variants[0];
  return variant.bytes;
}

/**
 * The curated seed catalog, ordered from smallest to largest.
 *
 * Sizes are the combined `onnx/model_{dtype}.onnx` (+ external `_data`) totals
 * verified against the Hub on 2026-06-10.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'smollm2-135m-instruct',
    name: 'SmolLM2 135M Instruct',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    revision: 'main',
    engine: 'transformers',
    architecture: 'smollm2',
    parameters: 134_515_008,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 117_691_126 },
      { dtype: 'q4', bytes: 182_068_553 },
      { dtype: 'q8', bytes: 137_147_981 },
      { dtype: 'fp16', bytes: 270_267_067 },
      { dtype: 'fp32', bytes: 540_345_794 },
    ],
    description:
      'Tiny 135M model — fits virtually every device, including phones. Fastest to download and run.',
    popularity: { downloads: 1_543_897, likes: 340 },
  },
  {
    id: 'qwen2.5-0.5b-instruct',
    name: 'Qwen2.5 0.5B Instruct',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: 'main',
    engine: 'transformers',
    architecture: 'qwen2',
    parameters: 494_032_768,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 483_003_582 },
      { dtype: 'q8', bytes: 512_096_557 },
      { dtype: 'q4', bytes: 786_156_820 },
      { dtype: 'fp16', bytes: 997_354_499 },
      { dtype: 'fp32', bytes: 1_993_796_793 },
    ],
    description:
      'Multilingual Qwen2.5 0.5B — strong quality for its size, fits phones at 4-bit.',
    popularity: { downloads: 5_729, likes: 15 },
  },
  {
    id: 'smollm2-360m-instruct',
    name: 'SmolLM2 360M Instruct',
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    revision: 'main',
    engine: 'transformers',
    architecture: 'smollm2',
    parameters: 361_821_120,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 272_737_275 },
      { dtype: 'q8', bytes: 364_564_671 },
      { dtype: 'q4', bytes: 387_943_246 },
      { dtype: 'fp16', bytes: 724_891_911 },
      { dtype: 'fp32', bytes: 1_449_582_810 },
    ],
    description:
      'Balanced 360M model — better quality, fits phones and tablets at 4/8-bit.',
    popularity: { downloads: 270_596, likes: 193 },
  },
  {
    id: 'gemma-3-1b-it',
    name: 'Gemma 3 1B Instruct',
    repo: 'onnx-community/gemma-3-1b-it-ONNX',
    revision: 'main',
    engine: 'transformers',
    architecture: 'gemma',
    parameters: 999_885_952,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 763_529_245 },
      { dtype: 'q4', bytes: 859_454_179 },
      { dtype: 'q8', bytes: 1_001_481_982 },
      { dtype: 'fp16', bytes: 2_033_972_730 },
      { dtype: 'fp32', bytes: 2_070_575_091 },
    ],
    description:
      "Google's Gemma 3 1B — high quality; fits most laptops and tablets at 4-bit.",
    popularity: { downloads: 677, likes: 25 },
  },
  {
    id: 'tinyllama-1.1b-chat',
    name: 'TinyLlama 1.1B Chat',
    repo: 'Xenova/TinyLlama-1.1B-Chat-v1.0',
    revision: 'main',
    engine: 'transformers',
    architecture: 'llama',
    parameters: 1_100_048_384,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 713_747_554 },
      { dtype: 'q4', bytes: 909_644_834 },
      { dtype: 'q8', bytes: 1_101_090_183 },
      { dtype: 'fp16', bytes: 2_200_717_222 },
      { dtype: 'fp32', bytes: 4_400_802_762 },
    ],
    description:
      'Popular 1.1B Llama chat model — fits laptops and high-end phones at 4-bit.',
    popularity: { downloads: 2_080_952, likes: 1_614 },
  },
  {
    id: 'qwen2.5-1.5b-instruct',
    name: 'Qwen2.5 1.5B Instruct',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    revision: 'main',
    engine: 'transformers',
    architecture: 'qwen2',
    parameters: 1_543_714_304,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 1_221_878_940 },
      { dtype: 'q8', bytes: 1_578_954_293 },
      { dtype: 'q4', bytes: 1_787_566_590 },
      { dtype: 'fp16', bytes: 3_105_275_452 },
      { dtype: 'fp32', bytes: 6_209_469_491 },
    ],
    description:
      'Capable Qwen2.5 1.5B — needs a laptop/desktop; best at 4-bit on WebGPU.',
    popularity: { downloads: 1_458, likes: 6 },
  },
  {
    id: 'smollm2-1.7b-instruct',
    name: 'SmolLM2 1.7B Instruct',
    repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    revision: 'main',
    engine: 'transformers',
    architecture: 'smollm2',
    parameters: 1_711_376_384,
    webgpu: true,
    variants: [
      { dtype: 'q4f16', bytes: 1_108_730_338 },
      { dtype: 'q4', bytes: 1_411_969_607 },
      { dtype: 'q8', bytes: 1_714_119_778 },
      { dtype: 'fp16', bytes: 3_423_959_956 },
      { dtype: 'fp32', bytes: 6_847_768_268 },
    ],
    description:
      'Largest SmolLM2 — highest quality of the family; needs a capable device, 4-bit recommended.',
    popularity: { downloads: 168_446, likes: 733 },
  },
  {
    id: 'phi-3.5-mini-instruct',
    name: 'Phi-3.5 mini Instruct',
    repo: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
    revision: 'main',
    engine: 'transformers',
    architecture: 'phi3',
    parameters: 3_821_079_552,
    webgpu: true,
    variants: [{ dtype: 'q4f16', bytes: 2_317_473_274 }],
    description:
      "Microsoft's Phi-3.5 mini (3.8B) — top quality; large, best on a WebGPU desktop at 4-bit.",
    popularity: { downloads: 678, likes: 15 },
  },
  {
    // Preserves the project's original Rust/candle WebAssembly engine as a
    // selectable, CPU-only option. Loads F32 safetensors directly (no ONNX).
    id: 'smollm2-135m-candle',
    name: 'SmolLM2 135M (Rust/candle, CPU)',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    revision: 'main',
    engine: 'candle',
    architecture: 'smollm2',
    parameters: 134_515_008,
    webgpu: false,
    variants: [],
    promptFormat: 'chatml',
    files: {
      weights: { name: 'model.safetensors', bytes: 269_060_552 },
      tokenizer: { name: 'tokenizer.json', bytes: 2_104_556 },
      config: { name: 'config.json', bytes: 861 },
    },
    description:
      'The original pure-Rust WebAssembly engine (candle), CPU-only, F32 weights. No WebGPU or quantization.',
    popularity: { downloads: 1_543_897, likes: 340 },
  },
];

/** Look up a catalog entry by its id. */
export function getModelById(
  id: string,
  catalog: ModelCatalogEntry[] = MODEL_CATALOG
): ModelCatalogEntry | undefined {
  return catalog.find((m) => m.id === id);
}

/**
 * Build the prompt string for a single-turn user message using the candle
 * engine's manual templates. (The transformers engine uses the tokenizer's
 * built-in chat template instead — see worker.ts.)
 */
export function formatPrompt(entry: ModelCatalogEntry, userText: string): string {
  switch (entry.promptFormat) {
    case 'zephyr':
      // TinyLlama-Chat (Zephyr): <|user|> ... </s> <|assistant|>
      return `<|user|>\n${userText}</s>\n<|assistant|>\n`;
    case 'chatml':
    default:
      // SmolLM2-Instruct (ChatML): <|im_start|>user ... <|im_end|> <|im_start|>assistant
      return `<|im_start|>user\n${userText}<|im_end|>\n<|im_start|>assistant\n`;
  }
}
