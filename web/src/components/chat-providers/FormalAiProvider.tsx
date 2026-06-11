/**
 * Formal-AI–style chat surface — the default, built-in provider.
 *
 * This is a small, dependency-free chat UI that mirrors the look and feel of the
 * Formal-AI web app (https://github.com/link-assistant/formal-ai): a scrolling
 * message list with avatars, author + timestamp meta rows, per-message "copy"
 * buttons, markdown rendering with syntax-highlighted code, a "Thinking…" pending
 * indicator, and an auto-growing composer that sends on Enter (Shift+Enter inserts
 * a newline). It renders purely from the external `messages` array so it works
 * with the streaming worker the same way every other provider does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ChatProviderProps, ChatMessage } from '../../types/chat';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable (e.g. insecure context) — ignore */
    }
  }, [text]);
  return (
    <button
      type="button"
      className="fa-copy-button"
      onClick={onCopy}
      title="Copy message markdown"
      aria-label="Copy message"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user';
  return (
    <article
      className={`fa-message ${isUser ? 'fa-message--outgoing' : 'fa-message--incoming'}`}
      data-testid={isUser ? 'message-user' : 'message-assistant'}
    >
      <div className="fa-message-avatar" aria-hidden="true">
        {isUser ? 'You' : 'AI'}
      </div>
      <div className="fa-message-body">
        <div className="fa-message-meta">
          <span className="fa-message-author">
            {isUser ? 'You' : 'Assistant'}
          </span>
          <time className="fa-message-time">
            {message.timestamp.toLocaleTimeString()}
          </time>
          {message.content.trim().length > 0 && (
            <CopyButton text={message.content} />
          )}
        </div>
        <MarkdownRenderer
          className="markdown-content fa-message-content"
          content={message.content}
        />
      </div>
    </article>
  );
}

export function FormalAiProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  // Auto-grow the textarea up to a max height as the user types.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // Keep the latest message in view as the conversation grows / streams.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isTyping]);

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || isDisabled || isTyping) return;
    onSendMessage(text);
    setValue('');
  }, [value, isDisabled, isTyping, onSendMessage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <div className="fa-chat" data-testid="own-chat">
      <div className="fa-message-list">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isTyping && (
          <div className="fa-typing" data-testid="typing-indicator">
            <span className="fa-typing-dot" />
            <span className="fa-typing-dot" />
            <span className="fa-typing-dot" />
            <span className="fa-typing-text">Thinking...</span>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      <form
        className="fa-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={textareaRef}
          className="fa-composer-input"
          data-testid="composer-input"
          rows={1}
          value={value}
          placeholder={
            isDisabled ? 'Waiting for model…' : 'Type a message — Enter to send'
          }
          disabled={isDisabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
        />
        <button
          type="submit"
          className="fa-composer-send"
          data-testid="composer-send"
          disabled={isDisabled || isTyping || value.trim().length === 0}
          aria-label="Send message"
          title="Send message"
        >
          {isTyping ? '…' : '↑'}
        </button>
      </form>
    </div>
  );
}
