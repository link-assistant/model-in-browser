import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatProviderProvider } from './context/ChatProviderContext';
import { ChatContainer } from './components/ChatContainer';
import { ChatProviderSelector } from './components/ChatProviderSelector';
import { ModelSelector } from './components/ModelSelector';
import type { WorkerMessage, LoadPayload, GeneratePayload } from './worker';
import type { ChatMessage } from './types/chat';
import {
  MODEL_CATALOG,
  modelUrls,
  formatPrompt,
  getModelById,
  downloadBytes,
  type Dtype,
  type ModelCatalogEntry,
} from './models/catalog';
import {
  detectDeviceCapabilities,
  pickBestDtype,
  formatBytes,
  type DeviceCapabilities,
} from './models/device';
import {
  evaluateCatalog,
  fetchLivePopularity,
  fetchLiveCatalogSizes,
  discoverModels,
  mergeCatalog,
  pickRecommended,
  type EvaluatedModel,
} from './models/registry';

// Auto-download cap: on first visit we only auto-load the recommended model
// when its download stays under this size, so a large model never starts a
// multi-gigabyte download without an explicit click. Larger models remain
// selectable (one click loads them). An explicit `?model=` override bypasses
// this cap.
const AUTO_LOAD_MAX_BYTES = 700 * 1024 * 1024;

/** Read an optional `?model=` / `?dtype=` override from the URL (handy for
 * sharable links and deterministic e2e tests). */
function readUrlOverride(): { model: string | null; dtype: Dtype | null } {
  if (typeof window === 'undefined') return { model: null, dtype: null };
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      model: params.get('model'),
      dtype: (params.get('dtype') as Dtype | null) ?? null,
    };
  } catch {
    return { model: null, dtype: null };
  }
}

type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ProgressInfo {
  label: string;
  loaded: number;
  total: number;
  progress: number;
}

// Generate unique message IDs
let messageIdCounter = 0;
function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateMessageId(),
      content:
        "Hello! I'm a small language model running entirely in your browser. Pick a model below that fits your device — the recommended one downloads automatically. You can start chatting once it's ready!",
      sender: 'assistant',
      timestamp: new Date(),
    },
  ]);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [statusText, setStatusText] = useState('Detecting device...');
  const [isTyping, setIsTyping] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  // Model selection state
  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>(MODEL_CATALOG);
  const [evaluated, setEvaluated] = useState<EvaluatedModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const currentResponseRef = useRef<string>('');
  const currentResponseIdRef = useRef<string>('');
  // The model whose weights are currently loaded, used to format prompts.
  const loadedEntryRef = useRef<ModelCatalogEntry | null>(null);
  // Guards the one-time automatic load of the recommended model.
  const autoLoadTriggeredRef = useRef(false);
  // Live mirrors of state needed inside the stable loadModelEntry callback.
  const capsRef = useRef<DeviceCapabilities | null>(null);
  const evaluatedRef = useRef<EvaluatedModel[]>([]);
  const catalogRef = useRef<ModelCatalogEntry[]>(MODEL_CATALOG);
  const overrideRef = useRef(readUrlOverride());

  // The quantization to use for an entry on this device: the per-model choice
  // from the evaluated catalog, or a freshly computed best dtype.
  const chosenDtypeFor = useCallback((entry: ModelCatalogEntry): Dtype | undefined => {
    if (entry.engine !== 'transformers') return undefined;
    if (overrideRef.current.dtype) return overrideRef.current.dtype;
    const ev = evaluatedRef.current.find((m) => m.entry.id === entry.id);
    if (ev?.dtype) return ev.dtype;
    return capsRef.current ? pickBestDtype(entry, capsRef.current) : entry.variants[0]?.dtype;
  }, []);

  // Send a load request for a given model entry, dispatching by engine.
  const loadModelEntry = useCallback(
    (entry: ModelCatalogEntry) => {
      if (!workerRef.current) return;
      setSelectedId(entry.id);
      setStatus('loading');
      setStatusText(`Loading ${entry.name}...`);
      setProgress(null);

      let loadPayload: LoadPayload;
      if (entry.engine === 'transformers') {
        const caps = capsRef.current;
        const device: 'webgpu' | 'wasm' =
          entry.webgpu && caps?.webGpuAdapter ? 'webgpu' : 'wasm';
        loadPayload = {
          engine: 'transformers',
          repo: entry.repo,
          revision: entry.revision,
          dtype: chosenDtypeFor(entry),
          device,
        };
      } else {
        const urls = modelUrls(entry);
        loadPayload = {
          engine: 'candle',
          modelUrl: urls.modelUrl,
          tokenizerUrl: urls.tokenizerUrl,
          configUrl: urls.configUrl,
        };
      }
      workerRef.current.postMessage({ type: 'load', payload: loadPayload });
    },
    [chosenDtypeFor]
  );

  // Keep refs in sync for use inside the stable load callback.
  useEffect(() => {
    capsRef.current = caps;
  }, [caps]);
  useEffect(() => {
    evaluatedRef.current = evaluated;
  }, [evaluated]);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  // Detect device capabilities and evaluate the catalog on mount.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const detected = await detectDeviceCapabilities();
      if (cancelled) return;
      setCaps(detected);

      // Show an immediate evaluation using the static seed, then refresh live.
      setEvaluated(evaluateCatalog(MODEL_CATALOG, detected));
      const override = overrideRef.current;
      const overridden =
        override.model && getModelById(override.model, MODEL_CATALOG);
      const recommended = pickRecommended(MODEL_CATALOG, detected);
      setSelectedId(overridden ? override.model : recommended?.id ?? null);
      setStatusText('Ready to load a model');

      // Refresh the catalog from the live HuggingFace Hub in the background:
      // popularity + per-dtype sizes for the seed, plus dynamically discovered
      // popular Transformers.js models. Any failure keeps the static seed.
      try {
        const [withPopularity, discovered] = await Promise.all([
          fetchLivePopularity(MODEL_CATALOG, controller.signal).then((e) =>
            fetchLiveCatalogSizes(e, controller.signal)
          ),
          discoverModels(30, undefined, controller.signal).catch(() => []),
        ]);
        if (cancelled) return;
        const merged = mergeCatalog(withPopularity, discovered);
        setCatalog(merged);
        setEvaluated(evaluateCatalog(merged, detected));
      } catch {
        // Keep the static seed on failure.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Initialize the worker.
  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'status':
          // Surface granular worker progress (e.g. "Downloading model
          // files..."), but ignore the initial handshake message.
          if (payload !== 'Worker initialized') {
            setStatusText(payload as string);
          }
          break;

        case 'progress':
          setProgress(payload as ProgressInfo);
          break;

        case 'token':
          currentResponseRef.current += payload as string;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (
              lastIdx >= 0 &&
              updated[lastIdx].id === currentResponseIdRef.current
            ) {
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: currentResponseRef.current,
              };
            }
            return updated;
          });
          break;

        case 'complete': {
          const action = (payload as { action: string }).action;
          if (action === 'load') {
            setStatus('ready');
            setProgress(null);
            // selectedId is the model we asked the worker to load.
            setSelectedId((id) => {
              const entry = id ? getModelById(id, catalogRef.current) : null;
              loadedEntryRef.current = entry ?? null;
              setLoadedId(entry?.id ?? null);
              setStatusText(entry ? `${entry.name} ready` : 'Model ready');
              return id;
            });
          } else if (action === 'generate') {
            setIsTyping(false);
            setStatusText(
              loadedEntryRef.current
                ? `${loadedEntryRef.current.name} ready`
                : 'Model ready'
            );
          }
          break;
        }

        case 'error':
          setStatus('error');
          setStatusText(`Error: ${payload}`);
          setIsTyping(false);
          setProgress(null);
          break;
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once both the worker and a recommended model are ready, auto-load it once —
  // but only when the download is small enough (or explicitly requested via
  // `?model=`), so we never start a multi-gigabyte download unprompted.
  useEffect(() => {
    if (autoLoadTriggeredRef.current) return;
    if (!workerRef.current || !selectedId || caps == null) return;
    const entry = getModelById(selectedId, catalogRef.current);
    if (!entry) return;
    autoLoadTriggeredRef.current = true;

    const isOverride = overrideRef.current.model === entry.id;
    const dl = downloadBytes(entry, chosenDtypeFor(entry));
    if (!isOverride && dl > AUTO_LOAD_MAX_BYTES) {
      setStatusText(
        `${entry.name} recommended — click it to download (${formatBytes(dl)})`
      );
      return;
    }
    loadModelEntry(entry);
  }, [selectedId, caps, loadModelEntry, chosenDtypeFor]);

  // Handle a user choosing a model from the selector.
  const handleSelectModel = useCallback(
    (id: string) => {
      if (status === 'loading') return;
      const entry = getModelById(id, catalogRef.current);
      if (!entry || entry.id === loadedId) {
        setSelectedId(id);
        return;
      }
      loadModelEntry(entry);
    },
    [status, loadedId, loadModelEntry]
  );

  // Retry loading the currently selected model.
  const handleRetry = useCallback(() => {
    const entry = selectedId ? getModelById(selectedId, catalogRef.current) : null;
    if (entry) loadModelEntry(entry);
  }, [selectedId, loadModelEntry]);

  // Send a message
  const handleSend = useCallback(
    (text: string) => {
      if (!workerRef.current || status !== 'ready' || isTyping) return;
      const entry = loadedEntryRef.current;
      if (!entry) return;

      const userMessage: ChatMessage = {
        id: generateMessageId(),
        content: text,
        sender: 'user',
        timestamp: new Date(),
      };

      const assistantMessageId = generateMessageId();
      const aiPlaceholder: ChatMessage = {
        id: assistantMessageId,
        content: '',
        sender: 'assistant',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, aiPlaceholder]);
      setIsTyping(true);
      currentResponseRef.current = '';
      currentResponseIdRef.current = assistantMessageId;

      // The transformers engine applies the tokenizer's built-in chat template,
      // so it takes structured messages; the candle engine takes a manually
      // formatted prompt string.
      const generatePayload: GeneratePayload =
        entry.engine === 'transformers'
          ? { messages: [{ role: 'user', content: text }] }
          : { prompt: formatPrompt(entry, text) };
      generatePayload.params = { maxTokens: 256, temperature: 0.7, topP: 0.9 };

      workerRef.current.postMessage({ type: 'generate', payload: generatePayload });
    },
    [status, isTyping]
  );

  const getStatusIndicatorClass = () => {
    switch (status) {
      case 'loading':
        return 'loading';
      case 'ready':
        return 'ready';
      case 'error':
        return 'error';
      default:
        return '';
    }
  };

  const isDisabled = status !== 'ready';
  const loadedName = loadedEntryRef.current?.name ?? 'a model';

  return (
    <ChatProviderProvider defaultProvider="chatscope">
      <div className="app-container">
        <header className="header">
          <h1>Models in Browser</h1>
          <p>
            Small AI language models running entirely on your device — WebGPU
            accelerated when available, WebAssembly otherwise
          </p>
          <ChatProviderSelector />
        </header>

        <ModelSelector
          models={evaluated}
          caps={caps}
          selectedId={selectedId}
          loadedId={loadedId}
          busy={status === 'loading'}
          onSelect={handleSelectModel}
        />

        <div className="status-bar">
          <div className={`status-indicator ${getStatusIndicatorClass()}`} />
          <span data-testid="status-text">{statusText}</span>
          {status === 'error' && (
            <button className="load-button" onClick={handleRetry}>
              Retry Load
            </button>
          )}
        </div>

        {progress && (
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        )}

        <div className="chat-container">
          <ChatContainer
            messages={messages}
            isTyping={isTyping}
            isDisabled={isDisabled}
            onSendMessage={handleSend}
            statusText={statusText}
          />
        </div>

        <p className="model-info">
          Running {loadedName} | No data sent to servers | All processing happens
          locally
        </p>
      </div>
    </ChatProviderProvider>
  );
}

export default App;
