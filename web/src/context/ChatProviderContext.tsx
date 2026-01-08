import { createContext, useContext, useState, ReactNode } from 'react';
import type { ChatProviderType } from '../types/chat';

interface ChatProviderContextType {
  provider: ChatProviderType;
  setProvider: (provider: ChatProviderType) => void;
}

const ChatProviderContext = createContext<ChatProviderContextType | undefined>(
  undefined
);

interface ChatProviderProviderProps {
  children: ReactNode;
  defaultProvider?: ChatProviderType;
}

export function ChatProviderProvider({
  children,
  defaultProvider = 'chatscope',
}: ChatProviderProviderProps) {
  const [provider, setProvider] = useState<ChatProviderType>(defaultProvider);

  return (
    <ChatProviderContext.Provider value={{ provider, setProvider }}>
      {children}
    </ChatProviderContext.Provider>
  );
}

export function useChatProvider() {
  const context = useContext(ChatProviderContext);
  if (context === undefined) {
    throw new Error(
      'useChatProvider must be used within a ChatProviderProvider'
    );
  }
  return context;
}
