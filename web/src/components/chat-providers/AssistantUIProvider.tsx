import { useRef, useCallback, useMemo, useEffect } from 'react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { ChatProviderProps, ChatMessage } from '../../types/chat';
import type { ThreadMessageLike } from '@assistant-ui/react';

// Convert our ChatMessage to ThreadMessageLike format
function convertMessage(msg: ChatMessage): ThreadMessageLike {
  return {
    id: msg.id,
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: [{ type: 'text', text: msg.content }],
  };
}

interface AssistantUIRuntimeProps {
  messages: ChatMessage[];
  isTyping: boolean;
  isDisabled: boolean;
  onSendMessage: (message: string) => void;
}

function useAssistantUIRuntime({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: AssistantUIRuntimeProps) {
  const onSendMessageRef = useRef(onSendMessage);
  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
  }, [onSendMessage]);

  const threadMessages = useMemo(
    () => messages.map(convertMessage),
    [messages]
  );

  const runtime = useExternalStoreRuntime({
    isRunning: isTyping,
    isDisabled,
    messages: threadMessages,
    convertMessage: (msg: ThreadMessageLike) => msg,
    onNew: useCallback(async (message) => {
      const textContent = message.content.find((c) => c.type === 'text');
      if (textContent && 'text' in textContent) {
        onSendMessageRef.current(textContent.text);
      }
    }, []),
  });

  return runtime;
}

// Message content component with markdown support
function MessageContent() {
  return (
    <MessagePrimitive.Parts
      components={{
        Text: () => (
          <MarkdownTextPrimitive
            components={{
              p: ({ children }) => (
                <p style={{ margin: '0.5em 0' }}>{children}</p>
              ),
              code: ({ children, className }) => {
                const isCodeBlock = className?.includes('language-');
                if (isCodeBlock) {
                  return (
                    <pre
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.75em',
                        borderRadius: '0.375rem',
                        overflow: 'auto',
                        margin: '0.5em 0',
                      }}
                    >
                      <code className={className}>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      padding: '0.125em 0.25em',
                      borderRadius: '0.25rem',
                      fontSize: '0.875em',
                    }}
                  >
                    {children}
                  </code>
                );
              },
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#61dafb' }}
                >
                  {children}
                </a>
              ),
            }}
          />
        ),
      }}
    />
  );
}

// Single message component
function ChatMessage() {
  return (
    <MessagePrimitive.Root className="aui-message">
      <MessagePrimitive.If user>
        <div className="aui-message-user">
          <MessageContent />
        </div>
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <div className="aui-message-assistant">
          <MessageContent />
        </div>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

// Chat thread component
function ChatThread({
  isDisabled,
  isTyping,
}: {
  isDisabled: boolean;
  isTyping: boolean;
}) {
  return (
    <ThreadPrimitive.Root className="aui-thread-root">
      <ThreadPrimitive.Viewport className="aui-thread-viewport">
        <ThreadPrimitive.Empty>
          <div className="aui-empty">
            Start a conversation with SmolLM2
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            Message: ChatMessage,
          }}
        />
        {isTyping && (
          <div className="aui-typing-indicator">SmolLM2 is thinking...</div>
        )}
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="aui-composer">
        <ComposerPrimitive.Input
          placeholder={
            isDisabled ? 'Waiting for model...' : 'Type your message...'
          }
          className="aui-composer-input"
          disabled={isDisabled || isTyping}
        />
        <ComposerPrimitive.Send
          className="aui-composer-send"
          disabled={isDisabled || isTyping}
        >
          Send
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

export function AssistantUIProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  const runtime = useAssistantUIRuntime({
    messages,
    isTyping,
    isDisabled,
    onSendMessage,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread isDisabled={isDisabled} isTyping={isTyping} />
    </AssistantRuntimeProvider>
  );
}
