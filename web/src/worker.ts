/**
 * Inference Web Worker — runs model loading and text generation off the UI
 * thread so the page stays responsive.
 *
 * Two engines are supported and dispatched by the `engine` field of the load
 * request (see `models/catalog.ts`):
 *
 * - **transformers** — Hugging Face Transformers.js (ONNX Runtime Web). The
 *   default. Runs on **WebGPU** when the device offers a usable adapter, with an
 *   automatic **WASM** fallback, and loads **quantized** weights (q4/q4f16/q8/
 *   fp16/fp32). The tokenizer's built-in chat template is applied automatically.
 * - **candle** — the project's original Rust/WebAssembly engine. CPU-only, loads
 *   F32 safetensors and uses a manually-formatted prompt string.
 *
 * The ORT wasm binaries are served same-origin from `./ort/` (copied from
 * node_modules by `scripts/copy-ort.mjs`) so the WASM backend works under
 * cross-origin isolation and offline, with no CDN dependency.
 */

import type { Dtype } from './models/catalog';

// Message types for worker communication
export interface WorkerMessage {
  type:
    | 'init'
    | 'load'
    | 'generate'
    | 'clear'
    | 'status'
    | 'token'
    | 'complete'
    | 'error'
    | 'progress';
  payload?: unknown;
}

/** Engine selector mirrored from the catalog. */
export type WorkerEngine = 'transformers' | 'candle';

/** A single chat turn passed to the transformers engine. */
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LoadPayload {
  /** Which engine to use. Defaults to 'candle' when omitted (back-compat). */
  engine?: WorkerEngine;

  // --- transformers engine ---
  /** HuggingFace repo id, e.g. `HuggingFaceTB/SmolLM2-135M-Instruct`. */
  repo?: string;
  /** Branch/revision. */
  revision?: string;
  /** Quantization to load. */
  dtype?: Dtype;
  /** Preferred execution device. */
  device?: 'webgpu' | 'wasm';

  // --- candle engine ---
  modelUrl?: string;
  tokenizerUrl?: string;
  configUrl?: string;
}

export interface GeneratePayload {
  /** Pre-formatted prompt string (candle engine). */
  prompt?: string;
  /** Chat turns (transformers engine — chat template applied by the tokenizer). */
  messages?: ChatTurn[];
  params?: GenerationParams;
}

export interface GenerationParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function postMessage(message: WorkerMessage): void {
  self.postMessage(message);
}

/** Which engine currently holds a loaded model. */
let loadedEngine: WorkerEngine | null = null;

// ---------------------------------------------------------------------------
// candle (Rust/WASM) engine
// ---------------------------------------------------------------------------

interface SmolLM2Wasm {
  default: (input?: RequestInfo | URL) => Promise<void>;
  init_panic_hook: () => void;
  get_version: () => string;
  is_model_loaded: () => boolean;
  load_model: (
    weights: Uint8Array,
    tokenizer: string,
    config: string
  ) => Promise<void>;
  generate: (
    prompt: string,
    paramsJson: string,
    callback: (token: string) => void
  ) => Promise<string>;
  clear_model: () => void;
}

let wasm: SmolLM2Wasm | null = null;

/** Fetch a file as an ArrayBuffer with progress reporting. */
async function fetchWithProgress(
  url: string,
  label: string
): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) {
      const progress = (loaded / total) * 100;
      postMessage({
        type: 'progress',
        payload: { label, loaded, total, progress },
      });
    }
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

async function initWasm(): Promise<void> {
  if (wasm) return;
  try {
    postMessage({ type: 'status', payload: 'Initializing WASM module...' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wasmModule = (await import('./pkg/smollm2_wasm.js')) as unknown as SmolLM2Wasm;
    await wasmModule.default();
    wasmModule.init_panic_hook();
    wasm = wasmModule;
    const version = wasm.get_version();
    postMessage({
      type: 'status',
      payload: `WASM module initialized (v${version})`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize WASM: ${message}`);
  }
}

async function loadCandleModel(payload: LoadPayload): Promise<void> {
  await initWasm();
  if (!wasm) throw new Error('WASM module not initialized');
  if (!payload.modelUrl || !payload.tokenizerUrl || !payload.configUrl) {
    throw new Error('candle engine requires modelUrl, tokenizerUrl and configUrl');
  }

  postMessage({ type: 'status', payload: 'Downloading model files...' });

  const [weightsBuffer, tokenizerResponse, configResponse] = await Promise.all([
    fetchWithProgress(payload.modelUrl, 'Model weights'),
    fetch(payload.tokenizerUrl),
    fetch(payload.configUrl),
  ]);

  if (!tokenizerResponse.ok) {
    throw new Error(`Failed to fetch tokenizer: ${tokenizerResponse.statusText}`);
  }
  if (!configResponse.ok) {
    throw new Error(`Failed to fetch config: ${configResponse.statusText}`);
  }

  const tokenizerJson = await tokenizerResponse.text();
  const configJson = await configResponse.text();

  postMessage({ type: 'status', payload: 'Loading model into memory...' });
  await wasm.load_model(new Uint8Array(weightsBuffer), tokenizerJson, configJson);

  loadedEngine = 'candle';
  postMessage({ type: 'status', payload: 'Model loaded successfully!' });
  postMessage({ type: 'complete', payload: { action: 'load' } });
}

async function generateCandle(payload: GeneratePayload): Promise<void> {
  if (!wasm || !wasm.is_model_loaded()) {
    throw new Error('Model not loaded');
  }
  const prompt = payload.prompt ?? payload.messages?.map((m) => m.content).join('\n') ?? '';
  const params = {
    max_tokens: payload.params?.maxTokens ?? 256,
    temperature: payload.params?.temperature ?? 0.7,
    top_p: payload.params?.topP ?? 0.9,
    repeat_penalty: payload.params?.repeatPenalty ?? 1.1,
    repeat_last_n: payload.params?.repeatLastN ?? 64,
    seed: payload.params?.seed ?? Math.floor(Math.random() * 1000000),
  };

  postMessage({ type: 'status', payload: 'Generating response...' });
  const fullText = await wasm.generate(
    prompt,
    JSON.stringify(params),
    (token: string) => postMessage({ type: 'token', payload: token })
  );
  postMessage({ type: 'complete', payload: { action: 'generate', text: fullText } });
}

// ---------------------------------------------------------------------------
// transformers.js (ONNX Runtime Web) engine
// ---------------------------------------------------------------------------

// Loaded lazily so the (large) library is only fetched when actually needed and
// the candle-only path keeps working even if it fails to import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any;

let generator: AnyPipeline | null = null;
let generatorKey: string | null = null; // `${repo}@${revision}:${dtype}:${device}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transformersMod: any = null;

async function getTransformers() {
  if (transformersMod) return transformersMod;
  postMessage({ type: 'status', payload: 'Loading inference engine...' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('@huggingface/transformers');
  // Serve ORT wasm same-origin (see scripts/copy-ort.mjs); fall back to the
  // library default (CDN) if the local copy is missing.
  try {
    const base = new URL('./ort/', self.location.origin + '/').href;
    mod.env.backends.onnx.wasm.wasmPaths = base;
  } catch {
    /* keep library default */
  }
  // We download models straight from the Hub; no local model dir.
  mod.env.allowLocalModels = false;
  transformersMod = mod;
  return mod;
}

async function loadTransformersModel(payload: LoadPayload): Promise<void> {
  if (!payload.repo) throw new Error('transformers engine requires a repo');
  const revision = payload.revision ?? 'main';
  const dtype = payload.dtype ?? 'q8';
  const requested: 'webgpu' | 'wasm' = payload.device ?? 'wasm';
  const key = `${payload.repo}@${revision}:${dtype}:${requested}`;

  // Already loaded with the same configuration — nothing to do.
  if (generator && generatorKey === key) {
    loadedEngine = 'transformers';
    postMessage({ type: 'status', payload: 'Model loaded successfully!' });
    postMessage({ type: 'complete', payload: { action: 'load' } });
    return;
  }

  const mod = await getTransformers();

  // Dispose any previously-loaded transformers pipeline before loading another.
  if (generator?.dispose) {
    try {
      await generator.dispose();
    } catch {
      /* ignore */
    }
  }
  generator = null;
  generatorKey = null;

  postMessage({ type: 'status', payload: 'Downloading model files...' });

  const progress_callback = (info: {
    status?: string;
    file?: string;
    name?: string;
    loaded?: number;
    total?: number;
    progress?: number;
  }) => {
    if (info.status === 'progress' && info.total) {
      postMessage({
        type: 'progress',
        payload: {
          label: info.file ?? info.name ?? 'Model files',
          loaded: info.loaded ?? 0,
          total: info.total,
          progress: info.progress ?? 0,
        },
      });
    } else if (info.status === 'ready') {
      postMessage({ type: 'status', payload: 'Loading model into memory...' });
    }
  };

  const build = (device: 'webgpu' | 'wasm') =>
    mod.pipeline('text-generation', payload.repo, {
      revision,
      dtype,
      device,
      progress_callback,
    });

  try {
    generator = await build(requested);
  } catch (err) {
    // WebGPU can fail at pipeline-build time on some adapters — fall back to WASM.
    if (requested === 'webgpu') {
      postMessage({
        type: 'status',
        payload: 'WebGPU unavailable — falling back to CPU (WASM)...',
      });
      generator = await build('wasm');
    } else {
      throw err;
    }
  }

  generatorKey = key;
  loadedEngine = 'transformers';
  postMessage({ type: 'status', payload: 'Model loaded successfully!' });
  postMessage({ type: 'complete', payload: { action: 'load' } });
}

async function generateTransformers(payload: GeneratePayload): Promise<void> {
  if (!generator) throw new Error('Model not loaded');
  const mod = await getTransformers();

  const messages: ChatTurn[] =
    payload.messages ??
    (payload.prompt ? [{ role: 'user', content: payload.prompt }] : []);
  if (messages.length === 0) throw new Error('No prompt provided');

  postMessage({ type: 'status', payload: 'Generating response...' });

  const streamer = new mod.TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (text) postMessage({ type: 'token', payload: text });
    },
  });

  const temperature = payload.params?.temperature ?? 0.7;
  const output = await generator(messages, {
    max_new_tokens: payload.params?.maxTokens ?? 256,
    temperature,
    top_p: payload.params?.topP ?? 0.9,
    do_sample: temperature > 0,
    repetition_penalty: payload.params?.repeatPenalty ?? 1.1,
    streamer,
  });

  // output: [{ generated_text: [...messages, { role:'assistant', content }] }]
  let text = '';
  try {
    const gen = output?.[0]?.generated_text;
    if (Array.isArray(gen)) {
      text = gen[gen.length - 1]?.content ?? '';
    } else if (typeof gen === 'string') {
      text = gen;
    }
  } catch {
    /* best-effort */
  }

  postMessage({ type: 'complete', payload: { action: 'generate', text } });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function loadModel(payload: LoadPayload): Promise<void> {
  const engine = payload.engine ?? 'candle';
  if (engine === 'transformers') {
    await loadTransformersModel(payload);
  } else {
    await loadCandleModel(payload);
  }
}

async function generateText(payload: GeneratePayload): Promise<void> {
  if (loadedEngine === 'transformers') {
    await generateTransformers(payload);
  } else {
    await generateCandle(payload);
  }
}

async function clearModel(): Promise<void> {
  if (generator?.dispose) {
    try {
      await generator.dispose();
    } catch {
      /* ignore */
    }
  }
  generator = null;
  generatorKey = null;
  if (wasm) wasm.clear_model();
  loadedEngine = null;
  postMessage({ type: 'status', payload: 'Model cleared from memory' });
  postMessage({ type: 'complete', payload: { action: 'clear' } });
}

self.onmessage = async (event: MessageEvent<WorkerMessage>): Promise<void> => {
  const { type, payload } = event.data;
  try {
    switch (type) {
      case 'init':
        // The transformers engine needs no eager init; candle initialises on
        // first load. Nothing to do here.
        break;
      case 'load':
        await loadModel(payload as LoadPayload);
        break;
      case 'generate':
        await generateText(payload as GeneratePayload);
        break;
      case 'clear':
        await clearModel();
        break;
      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Worker error:', message);
    postMessage({ type: 'error', payload: message });
  }
};

// Signal that the worker is ready
postMessage({ type: 'status', payload: 'Worker initialized' });
