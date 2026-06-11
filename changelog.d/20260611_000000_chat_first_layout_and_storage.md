---
bump: minor
---

### Fixed
- The chat surface is now reachable. Previously the model catalogue rendered as a
  full-width grid that filled the viewport and pushed the chat composer
  off-screen, so selecting a model only downloaded it with no way to actually
  send a message. The app now uses a chat-first **three-panel layout** — a fixed
  sidebar (brand, conversations, engine picker, model catalogue, export/import)
  beside an always-visible chat column (issue #15).
- The model selector no longer collapses to a narrow strip when the **reachat**
  engine is active. The selector lives in its own sidebar column, structurally
  isolated from the chat engine's horizontal flex layout, with defensive
  `min-width` / `width` CSS as a backstop (issue #15).

### Added
- A built-in **Formal-AI–style** default chat engine (`FormalAiProvider`):
  avatars, per-message copy, markdown + code rendering, a "Thinking…" typing
  indicator, and an auto-growing composer (Enter to send, Shift+Enter for a
  newline) — mirroring the UX of
  [formal-ai](https://github.com/link-assistant/formal-ai).
- A **conversations panel**: create, switch, and delete conversations from the
  sidebar.
- **Links Notation (`.lino`) storage** for all chat data, mirroring the formal-ai
  web UI. Conversations are persisted to `localStorage` as a
  `model_in_browser_bundle` document, with sidebar **Export** (downloads
  `model-in-browser-chats.lino`) and **Import** controls.
- All chat engines from
  [react-chat-ui](https://github.com/link-assistant/react-chat-ui) are
  selectable: Formal-AI (default), Chatscope, Deep Chat, React Chat Elements,
  Assistant UI, and Reachat.
- E2E coverage guaranteeing the chat works: `e2e/chat-ux.spec.ts` (composer
  reachable beside the catalogue, every engine selectable without narrowing the
  selector, conversation management, and Links Notation export/import round-trips)
  plus the existing `e2e/inference.spec.ts` send→streamed-reply guarantee.
- Deep case study at `docs/case-studies/issue-15/`.
