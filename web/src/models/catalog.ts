/**
 * Curated catalog of small language models that can run client-side in the
 * browser via the project's WebAssembly (candle) inference engine.
 *
 * Scope and constraints (see docs/case-studies/issue-11 for the full analysis):
 *
 * - The WASM engine uses candle's Llama loader, so every model here must report
 *   `architectures: ["LlamaForCausalLM"]` on the HuggingFace Hub.
 * - The engine loads weights as F32 in memory (~4 bytes per parameter), which
 *   together with the wasm32 ~4 GiB address-space ceiling is the dominant
 *   constraint on which models actually fit a given device.
 * - Models must be ungated (no license click-through) so anonymous browser
 *   downloads succeed without an access token.
 *
 * Parameter counts and on-disk file sizes below were verified against the live
 * HuggingFace API (`/api/models/{id}` and `/api/models/{id}/tree/main`) on
 * 2026-06-10. `downloads`/`likes` are static fallbacks that the registry
 * refreshes from the live API at runtime when the network allows.
 */

/** Chat prompt template families used by the supported models. */
export type PromptFormat = 'chatml' | 'zephyr';

export interface ModelFile {
  /** Filename relative to the repo root on the Hub. */
  name: string;
  /** Size in bytes (the weights file dominates the download). */
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
  /** Total parameter count (from the Hub `safetensors.total` field). */
  parameters: number;
  /** Architecture family. Only `llama` is supported by the current engine. */
  architecture: 'llama';
  /** Prompt template the model was instruction-tuned with. */
  promptFormat: PromptFormat;
  /** The model weights, tokenizer and config files needed to load it. */
  files: {
    weights: ModelFile;
    tokenizer: ModelFile;
    config: ModelFile;
  };
  /** Short description shown in the selector. */
  description: string;
  /** Static popularity fallback (refreshed live from the Hub when possible). */
  popularity: {
    downloads: number;
    likes: number;
  };
}

/** Base URL for resolving a file from a HuggingFace repo. */
export function fileUrl(entry: ModelCatalogEntry, fileName: string): string {
  return `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${fileName}`;
}

/** Convenience accessors for the three URLs the worker needs. */
export function modelUrls(entry: ModelCatalogEntry): {
  modelUrl: string;
  tokenizerUrl: string;
  configUrl: string;
} {
  return {
    modelUrl: fileUrl(entry, entry.files.weights.name),
    tokenizerUrl: fileUrl(entry, entry.files.tokenizer.name),
    configUrl: fileUrl(entry, entry.files.config.name),
  };
}

/** Total bytes downloaded when loading a model (weights + tokenizer + config). */
export function downloadBytes(entry: ModelCatalogEntry): number {
  return (
    entry.files.weights.bytes +
    entry.files.tokenizer.bytes +
    entry.files.config.bytes
  );
}

/**
 * The curated catalog, ordered from smallest to largest.
 *
 * All entries are LlamaForCausalLM and ungated. SmolLM2 instruct models use the
 * ChatML template; TinyLlama uses the Zephyr template.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'smollm2-135m-instruct',
    name: 'SmolLM2 135M Instruct',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    revision: 'main',
    parameters: 134_515_008,
    architecture: 'llama',
    promptFormat: 'chatml',
    files: {
      weights: { name: 'model.safetensors', bytes: 269_060_552 },
      tokenizer: { name: 'tokenizer.json', bytes: 2_104_556 },
      config: { name: 'config.json', bytes: 861 },
    },
    description:
      'Tiny 135M model — fits virtually every device, including phones. Fastest to download and run.',
    popularity: { downloads: 1_543_897, likes: 340 },
  },
  {
    id: 'smollm2-360m-instruct',
    name: 'SmolLM2 360M Instruct',
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    revision: 'main',
    parameters: 361_821_120,
    architecture: 'llama',
    promptFormat: 'chatml',
    files: {
      weights: { name: 'model.safetensors', bytes: 723_674_912 },
      tokenizer: { name: 'tokenizer.json', bytes: 2_104_556 },
      config: { name: 'config.json', bytes: 846 },
    },
    description:
      'Balanced 360M model — better quality, fits tablets and PCs with a bit more memory.',
    popularity: { downloads: 270_596, likes: 193 },
  },
  {
    id: 'tinyllama-1.1b-chat',
    name: 'TinyLlama 1.1B Chat',
    repo: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    revision: 'main',
    parameters: 1_100_048_384,
    architecture: 'llama',
    promptFormat: 'zephyr',
    files: {
      weights: { name: 'model.safetensors', bytes: 2_200_119_864 },
      tokenizer: { name: 'tokenizer.json', bytes: 1_842_767 },
      config: { name: 'config.json', bytes: 608 },
    },
    description:
      'Popular 1.1B chat model — needs a capable PC; large download and high memory use.',
    popularity: { downloads: 2_080_952, likes: 1_614 },
  },
  {
    id: 'smollm2-1.7b-instruct',
    name: 'SmolLM2 1.7B Instruct',
    repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    revision: 'main',
    parameters: 1_711_376_384,
    architecture: 'llama',
    promptFormat: 'chatml',
    files: {
      weights: { name: 'model.safetensors', bytes: 3_422_777_952 },
      tokenizer: { name: 'tokenizer.json', bytes: 2_104_556 },
      config: { name: 'config.json', bytes: 908 },
    },
    description:
      'Largest SmolLM2 — highest quality but needs a high-memory desktop. Often exceeds the browser budget.',
    popularity: { downloads: 168_446, likes: 733 },
  },
];

/** Look up a catalog entry by its id. */
export function getModelById(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/**
 * Build the prompt string for a single-turn user message using the model's
 * instruction-tuning template.
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
