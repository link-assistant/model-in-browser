/**
 * SmolLM2 Web Worker for background model inference.
 *
 * This worker handles model loading and text generation in the background,
 * keeping the main UI thread responsive during inference.
 */

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

export interface LoadPayload {
  modelUrl: string;
  tokenizerUrl: string;
  configUrl: string;
}

export interface GeneratePayload {
  prompt: string;
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

// WASM module interface
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

/**
 * Post a message to the main thread.
 */
function postMessage(message: WorkerMessage): void {
  self.postMessage(message);
}

/**
 * Fetch a file as an ArrayBuffer with progress tracking.
 */
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

  // Combine chunks into single buffer
  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

/**
 * Initialize the WASM module.
 */
async function initWasm(): Promise<void> {
  if (wasm) return;

  try {
    postMessage({ type: 'status', payload: 'Initializing WASM module...' });

    // Dynamic import of the WASM module
    const wasmModule = (await import('./pkg/smollm2_wasm.js')) as SmolLM2Wasm;
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

/**
 * Load the SmolLM2 model.
 */
async function loadModel(payload: LoadPayload): Promise<void> {
  await initWasm();

  if (!wasm) {
    throw new Error('WASM module not initialized');
  }

  postMessage({ type: 'status', payload: 'Downloading model files...' });

  // Fetch all required files
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

  // Load the model
  await wasm.load_model(
    new Uint8Array(weightsBuffer),
    tokenizerJson,
    configJson
  );

  postMessage({ type: 'status', payload: 'Model loaded successfully!' });
  postMessage({ type: 'complete', payload: { action: 'load' } });
}

/**
 * Generate text from a prompt.
 */
async function generateText(payload: GeneratePayload): Promise<void> {
  if (!wasm || !wasm.is_model_loaded()) {
    throw new Error('Model not loaded');
  }

  const params = {
    max_tokens: payload.params?.maxTokens ?? 256,
    temperature: payload.params?.temperature ?? 0.7,
    top_p: payload.params?.topP ?? 0.9,
    repeat_penalty: payload.params?.repeatPenalty ?? 1.1,
    repeat_last_n: payload.params?.repeatLastN ?? 64,
    seed: payload.params?.seed ?? Math.floor(Math.random() * 1000000),
  };

  postMessage({ type: 'status', payload: 'Generating response...' });

  // Callback for streaming tokens
  const tokenCallback = (token: string): void => {
    postMessage({ type: 'token', payload: token });
  };

  const fullText = await wasm.generate(
    payload.prompt,
    JSON.stringify(params),
    tokenCallback
  );

  postMessage({ type: 'complete', payload: { action: 'generate', text: fullText } });
}

/**
 * Clear the model from memory.
 */
function clearModel(): void {
  if (wasm) {
    wasm.clear_model();
    postMessage({ type: 'status', payload: 'Model cleared from memory' });
    postMessage({ type: 'complete', payload: { action: 'clear' } });
  }
}

/**
 * Handle incoming messages from the main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>): Promise<void> => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'init':
        await initWasm();
        break;

      case 'load':
        await loadModel(payload as LoadPayload);
        break;

      case 'generate':
        await generateText(payload as GeneratePayload);
        break;

      case 'clear':
        clearModel();
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
