/**
 * Deep Chat provider — wraps the `deep-chat-react` engine (one of the live chat
 * engines showcased in https://github.com/link-assistant/react-chat-ui).
 *
 * Deep Chat owns its own message rendering and composer, so we bridge it to our
 * worker-driven streaming model:
 *
 *  - `history` seeds Deep Chat with the messages already in the active
 *    conversation (keyed on the first message id so switching conversations
 *    remounts it with fresh history).
 *  - A custom `connect.handler` intercepts each user submission, forwards the
 *    text to `onSendMessage`, and then streams the assistant's reply back into
 *    Deep Chat via the handler `signals` as our worker fills in the placeholder
 *    message. This keeps Deep Chat's bubbles in sync with the streamed tokens.
 */

import { useCallback, useEffect, useRef, type FC } from 'react';
import { DeepChat as DeepChatReact } from 'deep-chat-react';
import type { ChatProviderProps } from '../../types/chat';

// The `deep-chat-react` wrapper only strongly types its DOM events, so we cast
// it to a permissive component to pass Deep Chat's element properties (connect,
// history, messageStyles, …) without fighting the wrapper's narrow prop type.
const DeepChat = DeepChatReact as unknown as FC<Record<string, unknown>>;

interface DeepChatSignals {
  onResponse: (response: { text?: string; error?: string }) => Promise<void> | void;
  onOpen?: () => void;
  onClose?: () => void;
}
interface DeepChatBody {
  messages?: Array<{ role?: string; text?: string }>;
}

export function DeepChatProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  // Refs let the (stable) handler and the streaming effect coordinate without
  // re-creating Deep Chat's connect object on every render.
  const signalsRef = useRef<DeepChatSignals | null>(null);
  const sentLenRef = useRef(0);
  const startedRef = useRef(false);
  const isDisabledRef = useRef(isDisabled);
  const isTypingRef = useRef(isTyping);

  useEffect(() => {
    isDisabledRef.current = isDisabled;
  }, [isDisabled]);
  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  // Stream the worker's tokens into Deep Chat. Each time the active assistant
  // message grows we forward the delta; when generation finishes we close.
  useEffect(() => {
    const signals = signalsRef.current;
    if (!signals) return;
    if (isTyping) startedRef.current = true;

    let lastAssistant = '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].sender === 'assistant') {
        lastAssistant = messages[i].content;
        break;
      }
    }
    if (lastAssistant.length > sentLenRef.current) {
      const delta = lastAssistant.slice(sentLenRef.current);
      sentLenRef.current = lastAssistant.length;
      void signals.onResponse({ text: delta });
    }

    if (startedRef.current && !isTyping) {
      signals.onClose?.();
      signalsRef.current = null;
      sentLenRef.current = 0;
      startedRef.current = false;
    }
  }, [messages, isTyping]);

  const handler = useCallback(
    (body: DeepChatBody, signals: DeepChatSignals) => {
      const list = body?.messages ?? [];
      const last = list[list.length - 1];
      const text = (typeof last?.text === 'string' ? last.text : '').trim();
      if (!text) {
        signals.onClose?.();
        return;
      }
      if (isDisabledRef.current || isTypingRef.current) {
        void signals.onResponse({
          text: 'The model is still loading — please wait a moment and try again.',
        });
        signals.onClose?.();
        return;
      }
      signalsRef.current = signals;
      sentLenRef.current = 0;
      startedRef.current = false;
      onSendMessage(text);
    },
    [onSendMessage]
  );

  // Seed Deep Chat with the conversation so far. Remount (via key) when the
  // conversation changes so its internal state is replaced, not appended to.
  const history = messages.map((m) => ({
    role: m.sender === 'user' ? 'user' : 'ai',
    text: m.content,
  }));
  const mountKey = messages[0]?.id ?? 'empty';

  return (
    <div className="deepchat-container">
      <DeepChat
        key={mountKey}
        connect={{ stream: true, handler }}
        history={history}
        avatars={true}
        textInput={{
          disabled: isDisabled,
          placeholder: {
            text: isDisabled ? 'Waiting for model…' : 'Type a message…',
          },
        }}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius: '0',
          backgroundColor: '#252525',
        }}
        messageStyles={{
          default: {
            ai: { bubble: { backgroundColor: '#2d4a5e', color: '#fff' } },
            user: { bubble: { backgroundColor: '#4a5e2d', color: '#fff' } },
          },
        }}
      />
    </div>
  );
}
