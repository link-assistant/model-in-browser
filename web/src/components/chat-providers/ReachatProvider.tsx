import { useMemo } from 'react';
import { Chat } from 'reachat';
import type { ChatProviderProps, ChatMessage } from '../../types/chat';
import type { Session, Conversation } from 'reachat';

// Convert our ChatMessage array to reachat Session format
function convertToSession(messages: ChatMessage[]): Session {
  // Group messages into conversation pairs (question + response)
  const conversations: Conversation[] = [];
  let currentQuestion: ChatMessage | null = null;

  for (const msg of messages) {
    if (msg.sender === 'user') {
      // If there was a previous unanswered question, add it as standalone
      if (currentQuestion) {
        conversations.push({
          id: currentQuestion.id,
          createdAt: currentQuestion.timestamp,
          question: currentQuestion.content,
          response: undefined,
        });
      }
      currentQuestion = msg;
    } else if (msg.sender === 'assistant') {
      if (currentQuestion) {
        conversations.push({
          id: currentQuestion.id,
          createdAt: currentQuestion.timestamp,
          updatedAt: msg.timestamp,
          question: currentQuestion.content,
          response: msg.content,
        });
        currentQuestion = null;
      } else {
        // Standalone assistant message (e.g., initial greeting)
        conversations.push({
          id: msg.id,
          createdAt: msg.timestamp,
          question: '',
          response: msg.content,
        });
      }
    }
  }

  // If there's an unanswered question at the end (typing)
  if (currentQuestion) {
    conversations.push({
      id: currentQuestion.id,
      createdAt: currentQuestion.timestamp,
      question: currentQuestion.content,
      response: undefined,
    });
  }

  return {
    id: 'main-session',
    title: 'SmolLM2 Chat',
    createdAt: new Date(),
    conversations,
  };
}

export function ReachatProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  const sessions = useMemo(() => [convertToSession(messages)], [messages]);

  return (
    <div className="reachat-container">
      <Chat
        viewType="chat"
        sessions={sessions}
        activeSessionId="main-session"
        isLoading={isTyping}
        disabled={isDisabled || isTyping}
        onSendMessage={onSendMessage}
      />
    </div>
  );
}
