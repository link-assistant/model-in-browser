# React Chat UI Library Detailed Comparison

## Data Collection Date
2026-01-08

## Libraries Evaluated

### 1. assistant-ui

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/assistant-ui/assistant-ui |
| **Stars** | 7,933 |
| **Forks** | 851 |
| **Open Issues** | 108 |
| **License** | MIT |
| **Last Updated** | 2026-01-08 |
| **TypeScript** | Yes (native) |

**Features**:
- Streaming responses
- Auto-scroll
- Retries
- Attachments
- Markdown rendering
- Code highlighting
- Keyboard shortcuts
- Accessibility support
- Tool call rendering
- Human approval flows
- Safe frontend actions

**Integrations**:
- AI SDK
- LangGraph
- Mastra
- Custom backends

**Architecture**: Radix-style composable primitives

---

### 2. react-markdown

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/remarkjs/react-markdown |
| **Stars** | 15,354 |
| **Forks** | 922 |
| **Open Issues** | 3 |
| **License** | MIT |
| **Last Updated** | 2026-01-07 |
| **TypeScript** | Yes |

**Features**:
- Safe markdown rendering (no dangerouslySetInnerHTML)
- CommonMark compliant
- GitHub Flavored Markdown via remark-gfm
- Custom component rendering
- Plugin system (remark/rehype)
- AST transformations

**Use Case**: Markdown rendering only (not a complete chat UI)

---

### 3. @chatscope/chat-ui-kit-react (Current)

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/chatscope/chat-ui-kit-react |
| **Stars** | 1,709 |
| **Forks** | 148 |
| **Open Issues** | 59 |
| **License** | MIT |
| **Last Updated** | 2026-01-07 |
| **TypeScript** | Yes (since v1.9.3) |

**Components**:
- MainContainer
- ChatContainer
- MessageList
- Message
- MessageInput
- TypingIndicator
- ConversationList
- Sidebar
- Avatar
- MessageSeparator

**Features**:
- CSS framework independent
- Comprehensive component library
- @chatscope/use-chat hook for state management
- Typing indicators
- Message groups

---

### 4. react-chat-elements

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/Detaysoft/react-chat-elements |
| **Stars** | 1,386 |
| **Forks** | 228 |
| **Open Issues** | 39 |
| **License** | MIT |
| **Last Updated** | 2026-01-08 |
| **TypeScript** | Yes |

**Components**:
- ChatList
- MessageBox
- MessageList
- SystemMessage
- Input
- Button
- Avatar
- Navbar
- SideBar
- Popup
- ReplyBar
- MeetingItem

**Message Types**:
- Text
- Photo
- Video
- Audio
- File
- Location
- Meeting
- Spotify

---

### 5. reachat

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/reaviz/reachat |
| **Stars** | 202 |
| **Forks** | 22 |
| **Open Issues** | N/A |
| **License** | MIT |
| **Last Updated** | 2026-01-07 |
| **TypeScript** | Yes |

**Features**:
- Console and companion layouts
- Markdown with code highlighting
- Tables
- YouTube embeds
- Links
- Custom remark plugins
- File handling
- File previews
- Light and dark themes

**Theming**: Tailwind CSS based

**Architecture**: React slots for component swapping

---

### 6. TelegramUI

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/telegram-mini-apps-dev/TelegramUI |
| **Stars** | 726 |
| **Forks** | 73 |
| **Open Issues** | 42 |
| **License** | MIT |
| **Last Updated** | 2026-01-05 |
| **TypeScript** | Yes |

**Purpose**: React components for Telegram Mini Apps

**Features**:
- Telegram-inspired interface
- Mini Apps integration
- Pre-designed components
- Easy customization

---

### 7. telegram-react

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/evgeny-nadymov/telegram-react |
| **Stars** | 2,527 |
| **Forks** | 665 |
| **Open Issues** | 201 |
| **License** | GPL-3.0 |
| **Last Updated** | 2026-01-07 |
| **TypeScript** | Yes |

**Features**:
- Full Telegram web client
- TDLib integration
- WebAssembly support
- Real Telegram API connection

**Note**: GPL-3.0 license - copyleft requirements

---

### 8. MinChat react-chat-ui

| Metric | Value |
|--------|-------|
| **GitHub** | https://github.com/MinChatHQ/react-chat-ui |
| **Stars** | 99 |
| **Forks** | 20 |
| **Open Issues** | 3 |
| **License** | MIT |
| **Last Updated** | 2026-01-05 |
| **TypeScript** | Yes (native) |

**Features**:
- Simple API
- Message bubbles
- Typing indicator
- Theme customization

---

## Recommendation Matrix

| Use Case | Recommended Library |
|----------|---------------------|
| AI Chat Application | assistant-ui |
| General Chat Widget | @chatscope/chat-ui-kit-react |
| Telegram-Style App | TelegramUI + custom components |
| LLM with Tailwind | reachat |
| Markdown Rendering | react-markdown |
| Simple Chat | react-chat-elements |

## Migration Complexity from Current (@chatscope)

| Target Library | Complexity | Effort |
|----------------|------------|--------|
| assistant-ui | High | 2-3 days |
| reachat | Medium | 1-2 days |
| react-chat-elements | Medium | 1-2 days |
| Add react-markdown | Low | 2-4 hours |

## Feature Comparison Matrix

| Feature | assistant-ui | chatscope | reachat | react-chat-elements |
|---------|--------------|-----------|---------|---------------------|
| Markdown Support | Yes | No | Yes | No |
| Code Highlighting | Yes | No | Yes | No |
| Streaming | Yes | Manual | Yes | No |
| TypeScript | Native | Available | Native | Available |
| Theming | Primitives | CSS Override | Tailwind | CSS |
| AI-Optimized | Yes | No | Yes | No |
| Message Types | Rich | Standard | Rich | Multiple |
| File Upload | Yes | No | Yes | Yes |
| Mobile Support | Yes | Yes | Yes | Yes |
