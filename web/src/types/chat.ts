/**
 * Chat types and interfaces for multi-provider chat UI support.
 *
 * The default provider is `formal-ai` — a built-in, dependency-free chat surface
 * that mirrors the UI/UX of the Formal-AI web app
 * (https://github.com/link-assistant/formal-ai): avatars, per-message copy,
 * markdown + code highlighting, and an auto-growing composer (Enter to send,
 * Shift+Enter for a newline). The remaining providers wrap the live chat engines
 * showcased in https://github.com/link-assistant/react-chat-ui so every engine
 * there is selectable here.
 */

export type ChatProviderType =
  | 'formal-ai'
  | 'chatscope'
  | 'deep-chat'
  | 'react-chat-elements'
  | 'assistant-ui'
  | 'reachat';

export interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
}

export interface ChatProviderProps {
  messages: ChatMessage[];
  isTyping: boolean;
  isDisabled: boolean;
  onSendMessage: (message: string) => void;
  statusText?: string;
}

export interface ChatProviderInfo {
  id: ChatProviderType;
  name: string;
  description: string;
}

export const CHAT_PROVIDERS: ChatProviderInfo[] = [
  {
    id: 'formal-ai',
    name: 'Formal-AI (default)',
    description:
      'Built-in Formal-AI–style chat: avatars, copy, markdown, auto-growing composer',
  },
  {
    id: 'chatscope',
    name: 'Chatscope',
    description: 'Classic chat UI with extensive components',
  },
  {
    id: 'deep-chat',
    name: 'Deep Chat',
    description: 'Configurable AI chat web component (deep-chat-react)',
  },
  {
    id: 'react-chat-elements',
    name: 'React Chat Elements',
    description: 'Simple and lightweight chat components',
  },
  {
    id: 'assistant-ui',
    name: 'Assistant UI',
    description: 'Modern AI chat interface with streaming support',
  },
  {
    id: 'reachat',
    name: 'Reachat',
    description: 'LLM-focused chat with Tailwind styling',
  },
];

/** The provider used by default — mirrors the Formal-AI web UI. */
export const DEFAULT_CHAT_PROVIDER: ChatProviderType = 'formal-ai';
