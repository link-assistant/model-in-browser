import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
} from '@chatscope/chat-ui-kit-react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ChatProviderProps } from '../../types/chat';

export function ChatscopeProvider({
  messages,
  isTyping,
  isDisabled,
  onSendMessage,
}: ChatProviderProps) {
  return (
    <MainContainer>
      <ChatContainer>
        <MessageList
          typingIndicator={
            isTyping ? (
              <TypingIndicator content="SmolLM2 is thinking..." />
            ) : null
          }
        >
          {messages.map((msg) => (
            <Message
              key={msg.id}
              model={{
                message: '',
                sentTime: msg.timestamp.toLocaleTimeString(),
                sender: msg.sender === 'user' ? 'You' : 'SmolLM2',
                direction: msg.sender === 'user' ? 'outgoing' : 'incoming',
                position: 'single',
              }}
            >
              <Message.CustomContent>
                <MarkdownRenderer content={msg.content} />
              </Message.CustomContent>
            </Message>
          ))}
        </MessageList>
        <MessageInput
          placeholder={
            isDisabled ? 'Waiting for model...' : 'Type your message...'
          }
          onSend={onSendMessage}
          disabled={isDisabled || isTyping}
          attachButton={false}
        />
      </ChatContainer>
    </MainContainer>
  );
}
