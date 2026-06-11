import { useChatProvider } from '../context/ChatProviderContext';
import {
  FormalAiProvider,
  ChatscopeProvider,
  DeepChatProvider,
  AssistantUIProvider,
  ReachatProvider,
  ReactChatElementsProvider,
} from './chat-providers';
import type { ChatProviderProps } from '../types/chat';

export function ChatContainer(props: ChatProviderProps) {
  const { provider } = useChatProvider();

  switch (provider) {
    case 'formal-ai':
      return <FormalAiProvider {...props} />;
    case 'chatscope':
      return <ChatscopeProvider {...props} />;
    case 'deep-chat':
      return <DeepChatProvider {...props} />;
    case 'assistant-ui':
      return <AssistantUIProvider {...props} />;
    case 'reachat':
      return <ReachatProvider {...props} />;
    case 'react-chat-elements':
      return <ReactChatElementsProvider {...props} />;
    default:
      return <FormalAiProvider {...props} />;
  }
}
