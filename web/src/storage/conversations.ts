/**
 * Conversation data model and browser persistence.
 *
 * All chat data — every conversation and message — is stored in the browser
 * (localStorage) and serialized to **Links Notation** (`.lino`, see
 * `links-notation.ts`), the same portable symbolic format used by the Formal-AI
 * web UI. A single `.lino` document is therefore enough to back up, export,
 * import, or migrate the entire chat history.
 *
 * The on-disk shape is a `model_in_browser_bundle` root holding metadata plus a
 * list of `conversation` nodes, each with `message` children:
 *
 * ```
 * model_in_browser_bundle
 *   version "1"
 *   exported_at "2026-06-10T12:00:00.000Z"
 *   conversation "conv_1"
 *     title "Getting started"
 *     createdAt "2026-06-10T11:59:00.000Z"
 *     updatedAt "2026-06-10T12:00:00.000Z"
 *     message "msg_1"
 *       role "user"
 *       content "Hi"
 *       sentAt "2026-06-10T11:59:30.000Z"
 *     message "msg_2"
 *       role "assistant"
 *       content "Hello!"
 *       sentAt "2026-06-10T12:00:00.000Z"
 * ```
 */

import type { ChatMessage } from '../types/chat';
import {
  serializeLino,
  parseLino,
  branch,
  leaf,
  valueByKey,
  type LinoNode,
} from './links-notation';

/** A single chat thread: an ordered list of messages plus metadata. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

/** Root identifier of an exported/imported bundle document. */
export const BUNDLE_ROOT = 'model_in_browser_bundle';

/** Schema version embedded in exported bundles (for future migrations). */
export const BUNDLE_VERSION = '1';

/** localStorage key under which the current bundle is persisted. */
export const STORAGE_KEY = 'mib_conversations_lino';

/** Derive a short conversation title from its first user message. */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.sender === 'user');
  const raw = firstUser?.content?.trim() ?? '';
  if (!raw) return 'New conversation';
  const oneLine = raw.replace(/\s+/g, ' ');
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

/** Serialize a single conversation into a Links Notation node. */
function conversationToNode(conv: Conversation): LinoNode {
  const children: LinoNode[] = [
    leaf('title', conv.title),
    leaf('createdAt', conv.createdAt.toISOString()),
    leaf('updatedAt', conv.updatedAt.toISOString()),
  ];
  for (const msg of conv.messages) {
    children.push(
      branch('message', msg.id, [
        leaf('role', msg.sender),
        leaf('content', msg.content),
        leaf('sentAt', msg.timestamp.toISOString()),
      ])
    );
  }
  return branch('conversation', conv.id, children);
}

/** Parse a Links Notation `conversation` node back into a Conversation. */
function nodeToConversation(node: LinoNode): Conversation | null {
  if (node.key !== 'conversation' || !node.value) return null;
  const messages: ChatMessage[] = [];
  for (const child of node.children) {
    if (child.key !== 'message' || !child.value) continue;
    const role = valueByKey(child, 'role');
    const content = valueByKey(child, 'content') ?? '';
    const sentAt = valueByKey(child, 'sentAt');
    messages.push({
      id: child.value,
      content,
      sender: role === 'user' ? 'user' : 'assistant',
      timestamp: sentAt ? new Date(sentAt) : new Date(),
    });
  }
  const createdAt = valueByKey(node, 'createdAt');
  const updatedAt = valueByKey(node, 'updatedAt');
  return {
    id: node.value,
    title: valueByKey(node, 'title') ?? deriveTitle(messages),
    createdAt: createdAt ? new Date(createdAt) : new Date(),
    updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
    messages,
  };
}

/**
 * Serialize a list of conversations into a `.lino` bundle document.
 *
 * @param conversations - conversations to serialize (most-recent-first order is
 *   preserved as given).
 * @param exportedAt - timestamp recorded in the bundle metadata.
 */
export function serializeBundle(
  conversations: Conversation[],
  exportedAt: Date = new Date()
): string {
  const meta: LinoNode[] = [
    leaf('version', BUNDLE_VERSION),
    leaf('exported_at', exportedAt.toISOString()),
  ];
  if (typeof window !== 'undefined') {
    try {
      meta.push(leaf('url', window.location.href));
    } catch {
      /* ignore */
    }
  }
  const root = branch(BUNDLE_ROOT, undefined, [
    ...meta,
    ...conversations.map(conversationToNode),
  ]);
  return serializeLino([root]);
}

/**
 * Parse a `.lino` bundle document back into conversations.
 *
 * Accepts both a full `model_in_browser_bundle` root and a bare list of
 * `conversation` nodes (legacy / partial documents), so imports are forgiving.
 * Returns an empty array for empty or unrecognized input.
 */
export function parseBundle(text: string): Conversation[] {
  const roots = parseLino(text);
  if (roots.length === 0) return [];

  // Collect conversation nodes from either the bundle root or the top level.
  const convNodes: LinoNode[] = [];
  for (const root of roots) {
    if (root.key === 'conversation') {
      convNodes.push(root);
    } else {
      for (const child of root.children) {
        if (child.key === 'conversation') convNodes.push(child);
      }
    }
  }

  return convNodes
    .map(nodeToConversation)
    .filter((c): c is Conversation => c !== null);
}

/** Persist conversations to localStorage as a `.lino` bundle. */
export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeBundle(conversations));
  } catch {
    /* storage may be full or unavailable — non-fatal */
  }
}

/** Load conversations from localStorage, or an empty array if none/invalid. */
export function loadConversations(): Conversation[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return [];
    return parseBundle(text);
  } catch {
    return [];
  }
}
