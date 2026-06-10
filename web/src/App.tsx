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
  type ModelCatalogEntry,
} from './models/catalog';
import {
  detectDeviceCapabilities,
  type DeviceCapabilities,
} from './models/device';
import {
  evaluateCatalog,
  fetchLivePopularity,
  pickRecommended,
  type EvaluatedModel,
} from './models/registry';

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

  // Send a load request for a given model entry.
  const loadModelEntry = useCallback((entry: ModelCatalogEntry) => {
    if (!workerRef.current) return;
    setSelectedId(entry.id);
    setStatus('loading');
    setStatusText(`Loading ${entry.name}...`);
    setProgress(null);
    const urls = modelUrls(entry);
    const loadPayload: LoadPayload = {
      modelUrl: urls.modelUrl,
      tokenizerUrl: urls.tokenizerUrl,
      configUrl: urls.configUrl,
    };
    workerRef.current.postMessage({ type: 'load', payload: loadPayload });
  }, []);

  // Detect device capabilities and evaluate the catalog on mount.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const detected = await detectDeviceCapabilities();
      if (cancelled) return;
      setCaps(detected);

      // Show an immediate evaluation using static popularity, then refresh.
      setEvaluated(evaluateCatalog(MODEL_CATALOG, detected));
      const recommended = pickRecommended(MODEL_CATALOG, detected);
      setSelectedId(recommended?.id ?? null);
      setStatusText('Ready to load a model');

      // Refresh popularity from the live HuggingFace Hub in the background.
      try {
        const refreshed = await fetchLivePopularity(
          MODEL_CATALOG,
          controller.signal
        );
        if (cancelled) return;
        setEvaluated(evaluateCatalog(refreshed, detected));
      } catch {
        // Keep static popularity on failure.
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
              const entry = id ? getModelById(id) : null;
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

  // Once both the worker and a recommended model are ready, auto-load it once.
  useEffect(() => {
    if (autoLoadTriggeredRef.current) return;
    if (!workerRef.current || !selectedId || caps == null) return;
    const entry = getModelById(selectedId);
    if (!entry) return;
    autoLoadTriggeredRef.current = true;
    loadModelEntry(entry);
  }, [selectedId, caps, loadModelEntry]);

  // Handle a user choosing a model from the selector.
  const handleSelectModel = useCallback(
    (id: string) => {
      if (status === 'loading') return;
      const entry = getModelById(id);
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
    const entry = selectedId ? getModelById(selectedId) : null;
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

      // Format the prompt using the loaded model's chat template.
      const prompt = formatPrompt(entry, text);

      const generatePayload: GeneratePayload = {
        prompt,
        params: {
          maxTokens: 256,
          temperature: 0.7,
          topP: 0.9,
        },
      };

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
            Small AI language models running entirely on your device via
            WebAssembly
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
          <span>{statusText}</span>
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
