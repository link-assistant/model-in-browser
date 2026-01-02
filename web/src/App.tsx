import { useState, useCallback, useRef, useEffect } from 'react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
  MessageModel,
} from '@chatscope/chat-ui-kit-react';
import type { WorkerMessage, LoadPayload, GeneratePayload } from './worker';

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

function App() {
  const [messages, setMessages] = useState<MessageModel[]>([
    {
      message:
        "Hello! I'm SmolLM2, a small language model running entirely in your browser. Load me to start chatting!",
      sentTime: 'just now',
      sender: 'SmolLM2',
      direction: 'incoming',
      position: 'single',
    },
  ]);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [statusText, setStatusText] = useState('Initializing...');
  const [isTyping, setIsTyping] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const currentResponseRef = useRef<string>('');

  // Initialize the worker
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
            if (lastIdx >= 0 && updated[lastIdx].sender === 'SmolLM2') {
              updated[lastIdx] = {
                ...updated[lastIdx],
                message: currentResponseRef.current,
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
      const userMessage: MessageModel = {
        message: text,
        sentTime: 'just now',
        sender: 'You',
        direction: 'outgoing',
        position: 'single',
      };

      // Add placeholder for AI response
      const aiPlaceholder: MessageModel = {
        message: '',
        sentTime: 'just now',
        sender: 'SmolLM2',
        direction: 'incoming',
        position: 'single',
      };

      setMessages((prev) => [...prev, userMessage, aiPlaceholder]);
      setIsTyping(true);
      currentResponseRef.current = '';

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

  return (
    <div className="app-container">
      <header className="header">
        <h1>SmolLM2 in Browser</h1>
        <p>AI language model running entirely on your device via WebAssembly</p>
      </header>

      <div className="status-bar">
        <div className={`status-indicator ${getStatusIndicatorClass()}`} />
        <span>{statusText}</span>
        {status === 'idle' && (
          <button className="load-button" onClick={handleLoadModel}>
            Load Model (~270MB)
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
        <MainContainer>
          <ChatContainer>
            <MessageList
              typingIndicator={
                isTyping ? (
                  <TypingIndicator content="SmolLM2 is thinking..." />
                ) : null
              }
            >
              {messages.map((msg, index) => (
                <Message key={index} model={msg} />
              ))}
            </MessageList>
            <MessageInput
              placeholder={
                status === 'ready'
                  ? 'Type your message...'
                  : 'Load the model first to start chatting'
              }
              onSend={handleSend}
              disabled={status !== 'ready' || isTyping}
              attachButton={false}
            />
          </ChatContainer>
        </MainContainer>
      </div>

      <p className="model-info">
        Using SmolLM2-135M-Instruct | No data sent to servers | All processing
        happens locally
      </p>
    </div>
  );
}

export default App;
