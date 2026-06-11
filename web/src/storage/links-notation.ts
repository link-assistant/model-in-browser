/**
 * Links Notation (`.lino`) — a tiny, indentation-based symbolic notation used to
 * store and exchange all of this app's chat data in the browser.
 *
 * It mirrors the format used by the Formal-AI web UI
 * (https://github.com/link-assistant/formal-ai), where every conversation and
 * message is serialized into a portable, human-readable `.lino` document so a
 * single file is enough to back up, migrate, or replay the chat state.
 *
 * ## Grammar
 *
 * A document is a tree of **nodes**, one per line. Indentation (2 spaces per
 * level) expresses nesting. Each line is:
 *
 * ```
 * <key>[ "<value>"]
 * ```
 *
 * - `<key>` is a bare identifier (the link "source"), e.g. `conversation`,
 *   `message`, `title`, `role`.
 * - `"<value>"` is an optional quoted string (the link "target"). Quotes and
 *   backslashes inside the value are escaped as `\"` and `\\`; newlines as
 *   `\n`, carriage returns as `\r`, tabs as `\t`.
 * - A node may have **both** a value and indented children (e.g.
 *   `conversation "conv_1"` followed by deeper `title`/`message` lines), or be a
 *   leaf with just a value (e.g. `content "Hello"`).
 *
 * Example:
 *
 * ```
 * model_in_browser_bundle
 *   version "1"
 *   conversation "conv_1"
 *     title "Getting started"
 *     message "msg_1"
 *       role "user"
 *       content "Hi"
 * ```
 *
 * This module is deliberately dependency-free and side-effect-free so it can be
 * unit-tested in isolation and reused from both the UI and a worker.
 */

/** A single node in a Links Notation tree. */
export interface LinoNode {
  /** The bare identifier on the left of the line (the link source). */
  key: string;
  /** The optional quoted value (the link target). `undefined` when absent. */
  value?: string;
  /** Indented child nodes. */
  children: LinoNode[];
}

const INDENT = '  '; // two spaces per nesting level

/** Escape a raw string for use inside a quoted Links Notation value. */
function escapeValue(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Reverse {@link escapeValue}. */
function unescapeValue(escaped: string): string {
  let out = '';
  for (let i = 0; i < escaped.length; i += 1) {
    const ch = escaped[i];
    if (ch === '\\' && i + 1 < escaped.length) {
      const next = escaped[i + 1];
      i += 1;
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        default:
          out += next;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Serialize a single node (and its subtree) at the given depth. */
function serializeNode(node: LinoNode, depth: number): string[] {
  const prefix = INDENT.repeat(depth);
  const line =
    node.value === undefined
      ? `${prefix}${node.key}`
      : `${prefix}${node.key} "${escapeValue(node.value)}"`;
  const lines = [line];
  for (const child of node.children) {
    lines.push(...serializeNode(child, depth + 1));
  }
  return lines;
}

/** Serialize a forest of Links Notation nodes into a `.lino` document string. */
export function serializeLino(nodes: LinoNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(...serializeNode(node, 0));
  }
  return lines.join('\n');
}

/** Split a raw line into its key and optional quoted value. */
function parseLine(content: string): { key: string; value?: string } {
  // Match: <key> optionally followed by a whitespace and a "quoted value".
  const match = content.match(/^(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*$/);
  if (!match) {
    // Fall back to treating the whole trimmed content as a bare key.
    return { key: content.trim() };
  }
  const key = match[1];
  const value = match[2] === undefined ? undefined : unescapeValue(match[2]);
  return { key, value };
}

/**
 * Parse a `.lino` document into a forest of {@link LinoNode}s.
 *
 * Indentation is measured in units of two leading spaces; blank lines are
 * ignored. Malformed indentation is handled gracefully by attaching a node to
 * the nearest shallower parent.
 */
export function parseLino(text: string): LinoNode[] {
  const roots: LinoNode[] = [];
  // Stack of [depth, node] for the current ancestry path.
  const stack: Array<{ depth: number; node: LinoNode }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const leading = rawLine.length - rawLine.trimStart().length;
    const depth = Math.floor(leading / INDENT.length);
    const { key, value } = parseLine(rawLine.trim());
    const node: LinoNode = { key, value, children: [] };

    // Pop until the top of the stack is a strictly-shallower parent.
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ depth, node });
  }

  return roots;
}

/** Convenience: find the first direct child with the given key. */
export function childByKey(node: LinoNode, key: string): LinoNode | undefined {
  return node.children.find((c) => c.key === key);
}

/** Convenience: the value of the first direct child with the given key. */
export function valueByKey(node: LinoNode, key: string): string | undefined {
  return childByKey(node, key)?.value;
}

/** Build a leaf node (`key "value"`). */
export function leaf(key: string, value: string): LinoNode {
  return { key, value, children: [] };
}

/** Build a branch node (`key "value"` with children). */
export function branch(
  key: string,
  value: string | undefined,
  children: LinoNode[]
): LinoNode {
  return { key, value, children };
}
