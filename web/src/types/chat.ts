/**
 * Chat types and interfaces for multi-provider chat UI support.
 */

export type ChatProviderType =
  | 'chatscope'
  | 'assistant-ui'
  | 'reachat'
  | 'react-chat-elements';

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
    id: 'chatscope',
    name: 'Chatscope',
    description: 'Classic chat UI with extensive components',
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
  {
    id: 'react-chat-elements',
    name: 'React Chat Elements',
    description: 'Simple and lightweight chat components',
  },
];
