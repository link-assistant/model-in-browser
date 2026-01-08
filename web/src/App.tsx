import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatProviderProvider } from './context/ChatProviderContext';
import { ChatContainer } from './components/ChatContainer';
import { ChatProviderSelector } from './components/ChatProviderSelector';
import type { WorkerMessage, LoadPayload, GeneratePayload } from './worker';
import type { ChatMessage } from './types/chat';

// Model configuration
const MODEL_CONFIG = {
  // Using SmolLM2-135M-Instruct from HuggingFace
  modelUrl:
    'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors',
  tokenizerUrl:
    'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/tokenizer.json',
  configUrl:
    'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/config.json',
};

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
        "Hello! I'm SmolLM2, a small language model running entirely in your browser. The model is downloading automatically - you can start chatting once it's ready!",
      sender: 'assistant',
      timestamp: new Date(),
    },
  ]);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [statusText, setStatusText] = useState('Initializing...');
  const [isTyping, setIsTyping] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const currentResponseRef = useRef<string>('');
  const currentResponseIdRef = useRef<string>('');

  // Track if auto-load has been triggered
  const autoLoadTriggeredRef = useRef(false);

  // Initialize the worker and automatically start model download
  useEffect(() => {
    // Create worker from worker.ts
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'status':
          setStatusText(payload as string);
          // Automatically start model loading when worker is initialized
          if (payload === 'Worker initialized' && !autoLoadTriggeredRef.current) {
            autoLoadTriggeredRef.current = true;
            // Use setTimeout to ensure state is updated before loading
            setTimeout(() => {
              if (workerRef.current) {
                setStatus('loading');
                setStatusText('Starting automatic download...');
                const loadPayload: LoadPayload = {
                  modelUrl: MODEL_CONFIG.modelUrl,
                  tokenizerUrl: MODEL_CONFIG.tokenizerUrl,
                  configUrl: MODEL_CONFIG.configUrl,
                };
                workerRef.current.postMessage({ type: 'load', payload: loadPayload });
              }
            }, 100);
          }
          break;

        case 'progress':
          setProgress(payload as ProgressInfo);
          break;

        case 'token':
          // Append token to current response
          currentResponseRef.current += payload as string;
          // Update the last message with the streaming response
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
            setStatusText('Model ready');
            setProgress(null);
          } else if (action === 'generate') {
            setIsTyping(false);
            setStatusText('Model ready');
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
  }, []);

  // Load the model
  const handleLoadModel = useCallback(() => {
    if (!workerRef.current || status === 'loading' || status === 'ready') return;

    setStatus('loading');
    setStatusText('Initializing...');

    const loadPayload: LoadPayload = {
      modelUrl: MODEL_CONFIG.modelUrl,
      tokenizerUrl: MODEL_CONFIG.tokenizerUrl,
      configUrl: MODEL_CONFIG.configUrl,
    };

    workerRef.current.postMessage({ type: 'load', payload: loadPayload });
  }, [status]);

  // Send a message
  const handleSend = useCallback(
    (text: string) => {
      if (!workerRef.current || status !== 'ready' || isTyping) return;

      // Add user message
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        content: text,
        sender: 'user',
        timestamp: new Date(),
      };

      // Add placeholder for AI response
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

      // Format prompt for the instruct model
      const prompt = `<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`;

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

  return (
    <ChatProviderProvider defaultProvider="chatscope">
      <div className="app-container">
        <header className="header">
          <h1>SmolLM2 in Browser</h1>
          <p>AI language model running entirely on your device via WebAssembly</p>
          <ChatProviderSelector />
        </header>

        <div className="status-bar">
          <div className={`status-indicator ${getStatusIndicatorClass()}`} />
          <span>{statusText}</span>
          {status === 'error' && (
            <button className="load-button" onClick={handleLoadModel}>
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
          Using SmolLM2-135M-Instruct | No data sent to servers | All processing
          happens locally
        </p>
      </div>
    </ChatProviderProvider>
  );
}

export default App;
