import { describe, it, expect } from 'vitest';
import {
  serializeLino,
  parseLino,
  leaf,
  branch,
  valueByKey,
  childByKey,
} from './links-notation';
import {
  serializeBundle,
  parseBundle,
  deriveTitle,
  BUNDLE_ROOT,
  type Conversation,
} from './conversations';
import type { ChatMessage } from '../types/chat';

describe('links-notation', () => {
  it('round-trips a simple tree', () => {
    const nodes = [
      branch('root', undefined, [
        leaf('a', 'one'),
        branch('b', 'id', [leaf('c', 'two')]),
      ]),
    ];
    const text = serializeLino(nodes);
    const parsed = parseLino(text);
    expect(parsed).toEqual(nodes);
  });

  it('serializes with two-space indentation', () => {
    const text = serializeLino([
      branch('root', undefined, [leaf('a', 'x')]),
    ]);
    expect(text).toBe('root\n  a "x"');
  });

  it('escapes and unescapes special characters', () => {
    const tricky = 'He said "hi"\nLine2\tTabbed \\ backslash';
    const text = serializeLino([leaf('content', tricky)]);
    // The raw newline must be escaped so the value stays on one line.
    expect(text).not.toContain('\n  ');
    expect(text.split('\n')).toHaveLength(1);
    const parsed = parseLino(text);
    expect(parsed[0].value).toBe(tricky);
  });

  it('parses values containing escaped quotes', () => {
    const parsed = parseLino('content "a \\"quoted\\" word"');
    expect(parsed[0].value).toBe('a "quoted" word');
  });

  it('ignores blank lines', () => {
    const parsed = parseLino('root\n\n  a "1"\n\n  b "2"\n');
    expect(parsed[0].children).toHaveLength(2);
  });

  it('exposes helpers childByKey / valueByKey', () => {
    const [root] = parseLino('root\n  title "T"\n  body "B"');
    expect(valueByKey(root, 'title')).toBe('T');
    expect(childByKey(root, 'body')?.value).toBe('B');
    expect(valueByKey(root, 'missing')).toBeUndefined();
  });
});

function msg(
  id: string,
  sender: 'user' | 'assistant',
  content: string,
  iso: string
): ChatMessage {
  return { id, sender, content, timestamp: new Date(iso) };
}

describe('conversations bundle', () => {
  const conv: Conversation = {
    id: 'conv_1',
    title: 'Greeting',
    createdAt: new Date('2026-06-10T11:00:00.000Z'),
    updatedAt: new Date('2026-06-10T11:05:00.000Z'),
    messages: [
      msg('m1', 'user', 'Hello there', '2026-06-10T11:00:30.000Z'),
      msg('m2', 'assistant', 'Hi! How can I help?', '2026-06-10T11:01:00.000Z'),
    ],
  };

  it('round-trips conversations through a .lino bundle', () => {
    const text = serializeBundle([conv], new Date('2026-06-10T12:00:00.000Z'));
    expect(text.startsWith(BUNDLE_ROOT)).toBe(true);
    const parsed = parseBundle(text);
    expect(parsed).toHaveLength(1);
    const [out] = parsed;
    expect(out.id).toBe(conv.id);
    expect(out.title).toBe(conv.title);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toMatchObject({
      id: 'm1',
      sender: 'user',
      content: 'Hello there',
    });
    expect(out.messages[1].sender).toBe('assistant');
    expect(out.createdAt.toISOString()).toBe(conv.createdAt.toISOString());
  });

  it('preserves multiline message content', () => {
    const multi: Conversation = {
      ...conv,
      messages: [
        msg('m1', 'user', 'Line 1\nLine 2\n\nLine 4', '2026-06-10T11:00:30.000Z'),
      ],
    };
    const parsed = parseBundle(serializeBundle([multi]));
    expect(parsed[0].messages[0].content).toBe('Line 1\nLine 2\n\nLine 4');
  });

  it('parses a bare list of conversation nodes (forgiving import)', () => {
    const text = serializeBundle([conv]);
    // Strip the bundle root + metadata, leaving conversation nodes dedented.
    const lines = text.split('\n').filter((l) => !/^\s*(version|exported_at|url) /.test(l));
    const body = lines
      .filter((l) => l !== BUNDLE_ROOT)
      .map((l) => l.replace(/^ {2}/, ''))
      .join('\n');
    const parsed = parseBundle(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('conv_1');
  });

  it('returns [] for empty or unrecognized input', () => {
    expect(parseBundle('')).toEqual([]);
    expect(parseBundle('garbage line without structure')).toEqual([]);
  });

  it('derives a title from the first user message', () => {
    expect(deriveTitle(conv.messages)).toBe('Hello there');
    expect(deriveTitle([])).toBe('New conversation');
    const long = 'x'.repeat(80);
    expect(deriveTitle([msg('m', 'user', long, '2026-06-10T11:00:00.000Z')]).length).toBeLessThanOrEqual(48);
  });
});
