import { useRef, useState, useCallback } from 'react';
import 'react-chat-elements/dist/main.css';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ChatProviderProps, ChatMessage } from '../../types/chat';

// Custom message renderer with markdown support
function CustomMessageBox({ message }: { message: ChatMessage }) {
  return (
    <div
      className={`rce-message-box ${message.sender === 'user' ? 'rce-right' : 'rce-left'}`}
    >
      <div className="rce-message-content">
        <div
          className="rce-message-title"
          style={{ color: message.sender === 'user' ? '#4a5e2d' : '#61dafb' }}
        >
          {message.sender === 'user' ? 'You' : 'SmolLM2'}
        </div>
        <div className="rce-message-text">
          <MarkdownRenderer content={message.content} />
        </div>
        <div className="rce-message-time">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

export function ReactChatElementsProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(() => {
    if (inputValue.trim() && !isDisabled && !isTyping) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  }, [inputValue, isDisabled, isTyping, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="rce-container">
      <div className="rce-message-list-wrapper" ref={messageListRef}>
        <div className="rce-message-list-custom">
          {messages.map((msg) => (
            <CustomMessageBox key={msg.id} message={msg} />
          ))}
          {isTyping && (
            <div className="rce-typing-indicator">SmolLM2 is thinking...</div>
          )}
        </div>
      </div>
      <div className="rce-input-container">
        <div className="rce-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="rce-custom-input"
            placeholder={
              isDisabled ? 'Waiting for model...' : 'Type your message...'
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isDisabled || isTyping}
          />
          <button
            className="rce-send-button"
            onClick={handleSend}
            disabled={isDisabled || isTyping || !inputValue.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
