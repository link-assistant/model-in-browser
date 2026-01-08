# Implementation Examples

## Quick Start Examples for Recommended Libraries

### 1. Adding Markdown Support to Current Implementation

This is the lowest-effort improvement that can be made immediately.

#### Installation

```bash
cd web
npm install react-markdown remark-gfm react-syntax-highlighter
npm install -D @types/react-syntax-highlighter
```

#### Create MarkdownMessage Component

```tsx
// web/src/components/MarkdownMessage.tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';

interface MarkdownMessageProps {
  content: string;
}

const components: Components = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: '0.5rem 0',
          borderRadius: '0.375rem',
          fontSize: '0.875rem',
        }}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code
        className={className}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          padding: '0.125rem 0.25rem',
          borderRadius: '0.25rem',
          fontSize: '0.875rem',
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  // Customize other elements
  p: ({ children }) => <p style={{ margin: '0.5rem 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ marginLeft: '1rem' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ marginLeft: '1rem' }}>{children}</ol>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: '#61dafb', textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
};

export const MarkdownMessage = ({ content }: MarkdownMessageProps) => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
};
```

#### Integration with App.tsx

```tsx
// In App.tsx, modify the Message component rendering
import { MarkdownMessage } from './components/MarkdownMessage';

// In the render function, instead of:
// <Message key={index} model={msg} />

// Use a custom content renderer:
<Message key={index} model={{
  ...msg,
  // Wrap message content in markdown renderer
  message: msg.message,
}}>
  <Message.CustomContent>
    <MarkdownMessage content={msg.message || ''} />
  </Message.CustomContent>
</Message>
```

---

### 2. Migration to assistant-ui

#### Installation

```bash
cd web
npm install @assistant-ui/react @assistant-ui/react-markdown
```

#### Basic Setup

```tsx
// web/src/App.tsx - assistant-ui version
import {
  AssistantRuntimeProvider,
  Thread,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

// Create adapter for your model
const MyModelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // Connect to your model here
    const response = await generateFromModel(messages, abortSignal);

    for await (const token of response) {
      yield { content: [{ type: 'text', text: token }] };
    }
  },
};

function App() {
  const runtime = useLocalRuntime(MyModelAdapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-screen">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

#### Custom Styling

```tsx
// With custom components
import {
  Thread,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react';

function CustomThread() {
  return (
    <ThreadPrimitive.Root className="custom-thread">
      <ThreadPrimitive.Viewport className="custom-viewport">
        <ThreadPrimitive.Messages
          components={{
            UserMessage: CustomUserMessage,
            AssistantMessage: CustomAssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <CustomComposer />
    </ThreadPrimitive.Root>
  );
}
```

---

### 3. Migration to reachat

#### Installation

```bash
cd web
npm install reachat
```

#### Basic Setup

```tsx
// web/src/App.tsx - reachat version
import { Chat, ChatInput, MessageList, Message } from 'reachat';

function App() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsLoading(true);

    // Generate response from model
    const response = await generateResponse(text);

    setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    setIsLoading(false);
  };

  return (
    <Chat>
      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInput onSend={handleSend} disabled={isLoading} />
    </Chat>
  );
}
```

---

### 4. Telegram-Style Styling Updates

If keeping @chatscope but wanting Telegram aesthetics:

```css
/* web/src/telegram-style.css */

/* Message bubbles with tails */
.cs-message--incoming .cs-message__content {
  background: #ffffff !important;
  color: #000000 !important;
  border-radius: 18px 18px 18px 4px !important;
  padding: 8px 12px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.cs-message--outgoing .cs-message__content {
  background: linear-gradient(135deg, #4fae4e 0%, #3d8b3c 100%) !important;
  color: #ffffff !important;
  border-radius: 18px 18px 4px 18px !important;
  padding: 8px 12px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Dark mode variant */
@media (prefers-color-scheme: dark) {
  .cs-message--incoming .cs-message__content {
    background: #212121 !important;
    color: #ffffff !important;
  }

  .cs-message--outgoing .cs-message__content {
    background: linear-gradient(135deg, #2b5278 0%, #1e3a52 100%) !important;
  }
}

/* Input area */
.cs-message-input {
  background: #f0f0f0 !important;
  border-radius: 25px !important;
  margin: 8px !important;
  padding: 4px 8px !important;
}

.cs-message-input__content-editor-wrapper {
  background: transparent !important;
  border-radius: 20px !important;
}

/* Send button */
.cs-button--send {
  background: #4fae4e !important;
  border-radius: 50% !important;
  width: 40px !important;
  height: 40px !important;
  color: white !important;
}

/* Animations */
.cs-message {
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

### 5. Streaming Markdown with Memoization

For performance with streaming responses:

```tsx
// web/src/components/MemoizedMarkdown.tsx
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Memoize individual blocks
const MemoizedBlock = memo(({ content }: { content: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
));

// Split content into blocks for granular memoization
export const StreamingMarkdown = memo(({ content }: { content: string }) => {
  const blocks = useMemo(() => {
    // Split by double newlines (paragraphs/blocks)
    return content.split(/\n\n+/).filter(Boolean);
  }, [content]);

  return (
    <div className="streaming-markdown">
      {blocks.map((block, index) => (
        <MemoizedBlock key={`${index}-${block.slice(0, 20)}`} content={block} />
      ))}
    </div>
  );
});
```

---

## Package.json Updates

If implementing markdown support:

```json
{
  "dependencies": {
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "react-syntax-highlighter": "^15.5.0"
  },
  "devDependencies": {
    "@types/react-syntax-highlighter": "^15.5.0"
  }
}
```

If migrating to assistant-ui:

```json
{
  "dependencies": {
    "@assistant-ui/react": "^0.5.0",
    "@assistant-ui/react-markdown": "^0.2.0"
  }
}
```

If migrating to reachat:

```json
{
  "dependencies": {
    "reachat": "^1.0.0",
    "tailwindcss": "^3.4.0"
  }
}
```
