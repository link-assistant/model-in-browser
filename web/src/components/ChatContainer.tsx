import { useChatProvider } from '../context/ChatProviderContext';
import {
  ChatscopeProvider,
  AssistantUIProvider,
  ReachatProvider,
  ReactChatElementsProvider,
} from './chat-providers';
import type { ChatProviderProps } from '../types/chat';

export function ChatContainer(props: ChatProviderProps) {
  const { provider } = useChatProvider();

  switch (provider) {
    case 'chatscope':
      return <ChatscopeProvider {...props} />;
    case 'assistant-ui':
      return <AssistantUIProvider {...props} />;
    case 'reachat':
      return <ReachatProvider {...props} />;
    case 'react-chat-elements':
      return <ReactChatElementsProvider {...props} />;
    default:
      return <ChatscopeProvider {...props} />;
  }
}
