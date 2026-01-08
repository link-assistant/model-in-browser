import { useChatProvider } from '../context/ChatProviderContext';
import { CHAT_PROVIDERS, type ChatProviderType } from '../types/chat';

export function ChatProviderSelector() {
  const { provider, setProvider } = useChatProvider();

  return (
    <div className="provider-selector">
      <label htmlFor="chat-provider-select">Chat UI:</label>
      <select
        id="chat-provider-select"
        value={provider}
        onChange={(e) => setProvider(e.target.value as ChatProviderType)}
        className="provider-select"
      >
        {CHAT_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id} title={p.description}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
