import { describe, expect, it } from 'vitest';
import { createDispatcher } from './bridge';
import { FORMAT_NAMES, parseIncomingMessage, PROTOCOL_VERSION, type DocEngineEvent } from './protocol';

const INIT = {
  v: PROTOCOL_VERSION,
  type: 'init' as const,
  payload: { theme: 'light' as const, platform: 'ios' as const },
};

describe('parseIncomingMessage', () => {
  it('parses a JSON string and an object with v=1', () => {
    expect(parseIncomingMessage(INIT)).toEqual({ ok: true, value: { type: 'init', payload: INIT.payload } });
    expect(parseIncomingMessage(JSON.stringify(INIT))).toEqual({
      ok: true,
      value: { type: 'init', payload: INIT.payload },
    });
  });

  it('rejects missing or non-1 version', () => {
    expect(parseIncomingMessage({ type: 'init', payload: INIT.payload }).ok).toBe(false);
    const bad = parseIncomingMessage({ v: 2, type: 'init', payload: INIT.payload });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/version/);
  });

  it('rejects invalid json and non-objects', () => {
    expect(parseIncomingMessage('{').ok).toBe(false);
    expect(parseIncomingMessage(null).ok).toBe(false);
    expect(parseIncomingMessage(1).ok).toBe(false);
  });

  it('rejects unknown command types and bad payloads', () => {
    expect(parseIncomingMessage({ v: 1, type: 'nope' }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'init', payload: { theme: 'neon', platform: 'ios' } }).ok).toBe(
      false,
    );
    expect(parseIncomingMessage({ v: 1, type: 'setContent', payload: { doc: { type: 'paragraph' } } }).ok).toBe(
      false,
    );
  });

  it('parses the remaining command shapes', () => {
    expect(
      parseIncomingMessage({
        v: 1,
        type: 'setContent',
        payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      }).ok,
    ).toBe(true);
    expect(
      parseIncomingMessage({
        v: 1,
        type: 'setEntities',
        payload: { cards: [{ id: 'c1' }], annotations: [{ id: 'n1', quote: 'q' }] },
      }).ok,
    ).toBe(true);
    expect(
      parseIncomingMessage({ v: 1, type: 'setActiveEntity', payload: { kind: 'card', id: null } }).ok,
    ).toBe(true);
    expect(parseIncomingMessage({ v: 1, type: 'focusCard', payload: { cardId: 'c1' } }).ok).toBe(true);
    expect(
      parseIncomingMessage({
        v: 1,
        type: 'injectAssetUrls',
        payload: { urls: { 'asset:x': 'https://a', 'asset:y': null } },
      }).ok,
    ).toBe(true);
    expect(parseIncomingMessage({ v: 1, type: 'setTheme', payload: { theme: 'dark' } }).ok).toBe(true);
  });

  it('parses setEditable true and false', () => {
    expect(parseIncomingMessage({ v: 1, type: 'setEditable', payload: { editable: true } })).toEqual({
      ok: true,
      value: { type: 'setEditable', payload: { editable: true } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'setEditable', payload: { editable: false } })).toEqual({
      ok: true,
      value: { type: 'setEditable', payload: { editable: false } },
    });
  });

  it('getDoc requires a non-empty requestId and ignores the envelope id', () => {
    expect(parseIncomingMessage({ v: 1, type: 'getDoc', payload: { requestId: 'r1' } })).toEqual({
      ok: true,
      value: { type: 'getDoc', payload: { requestId: 'r1' } },
    });
    expect(
      parseIncomingMessage({ v: 1, id: 'envelope', type: 'getDoc', payload: { requestId: 'r1' } }),
    ).toEqual({
      ok: true,
      value: { type: 'getDoc', payload: { requestId: 'r1' } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'getDoc', payload: { requestId: '' } }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, id: 'envelope', type: 'getDoc', payload: {} }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'getDoc', payload: { requestId: 1 } }).ok).toBe(false);
  });

  it('format accepts each name and rejects an unknown name', () => {
    for (const name of FORMAT_NAMES) {
      expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name } })).toEqual({
        ok: true,
        value: { type: 'format', payload: { name } },
      });
    }
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'underline' } }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: '' } }).ok).toBe(false);
  });

  it('format link and image accept optional strings and other names ignore extras', () => {
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'link' } })).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'link' } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'link', href: 'https://a.example' } })).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'link', href: 'https://a.example' } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'link', href: '' } })).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'link', href: '' } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'image' } })).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'image' } },
    });
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'image', src: 'asset:pic' } })).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'image', src: 'asset:pic' } },
    });
    expect(
      parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'bold', href: 'https://a', src: 'asset:x' } }),
    ).toEqual({
      ok: true,
      value: { type: 'format', payload: { name: 'bold' } },
    });
  });

  it('rejects bad editable payloads', () => {
    expect(parseIncomingMessage({ v: 1, type: 'setEditable' }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'setEditable', payload: { editable: 'yes' } }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'getDoc' }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format' }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: {} }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'link', href: 1 } }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'image', src: null } }).ok).toBe(false);
    expect(parseIncomingMessage({ v: 1, type: 'format', payload: { name: 'link', href: null } }).ok).toBe(false);
  });
});

describe('createDispatcher', () => {
  it('routes a valid command to the handler', () => {
    const seen: string[] = [];
    const events: DocEngineEvent[] = [];
    const dispatch = createDispatcher((cmd) => seen.push(cmd.type), (evt) => events.push(evt));
    dispatch(INIT);
    expect(seen).toEqual(['init']);
    expect(events).toEqual([]);
  });

  it('emits error for bad messages instead of throwing', () => {
    const events: DocEngineEvent[] = [];
    const dispatch = createDispatcher(() => undefined, (evt) => events.push(evt));
    dispatch('{');
    dispatch({ v: 2, type: 'init', payload: INIT.payload });
    dispatch({ v: 1, type: 'unknown' });
    expect(events).toHaveLength(3);
    expect(events.every((evt) => evt.type === 'error')).toBe(true);
  });

  it('emits error when the handler throws', () => {
    const events: DocEngineEvent[] = [];
    const dispatch = createDispatcher(
      () => {
        throw new Error('boom');
      },
      (evt) => events.push(evt),
    );
    dispatch(INIT);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        payload: expect.objectContaining({ message: 'boom' }),
      }),
    ]);
  });
});
