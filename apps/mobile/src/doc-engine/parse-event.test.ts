import { describe, expect, it } from 'vitest';
import { parseDocEngineEvent } from './parse-event';

function formatPayload(overrides: Record<string, unknown> = {}) {
  return {
    editable: true,
    bold: false,
    italic: false,
    strike: false,
    heading1: false,
    heading2: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
    blockquote: false,
    codeBlock: false,
    link: false,
    table: false,
    textAlign: 'left',
    canUndo: false,
    canRedo: true,
    ...overrides,
  };
}

describe('parseDocEngineEvent edit events', () => {
  it('accepts docChanged with or without a payload', () => {
    expect(parseDocEngineEvent({ v: 1, type: 'docChanged' })).toEqual({
      ok: true,
      value: { type: 'docChanged' },
    });
    expect(parseDocEngineEvent('{"v":1,"type":"docChanged"}')).toEqual({
      ok: true,
      value: { type: 'docChanged' },
    });
  });

  it('rejects docChanged on the wrong protocol version', () => {
    const result = parseDocEngineEvent({ v: 2, type: 'docChanged' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/protocol/);
  });

  it('accepts docJson and rejects a missing request or doc', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(parseDocEngineEvent({ v: 1, type: 'docJson', payload: { requestId: 'r1', doc } })).toEqual({
      ok: true,
      value: { type: 'docJson', payload: { requestId: 'r1', doc } },
    });
    expect(parseDocEngineEvent({ v: 1, type: 'docJson', payload: { requestId: '', doc } }).ok).toBe(false);
    expect(parseDocEngineEvent({ v: 1, type: 'docJson', payload: { requestId: 'r1' } }).ok).toBe(false);
    expect(
      parseDocEngineEvent({ v: 1, type: 'docJson', payload: { requestId: 'r1', doc: { type: 'paragraph' } } }).ok,
    ).toBe(false);
  });

  it('accepts formatState and rejects a bad align or flag', () => {
    const payload = formatPayload({ bold: true, textAlign: 'center', canUndo: true });
    expect(parseDocEngineEvent({ v: 1, type: 'formatState', payload })).toEqual({
      ok: true,
      value: { type: 'formatState', payload },
    });
    expect(parseDocEngineEvent({ v: 1, type: 'formatState', payload: formatPayload({ textAlign: 'justify' }) }).ok).toBe(
      false,
    );
    const { canRedo: _canRedo, ...missing } = formatPayload();
    expect(parseDocEngineEvent({ v: 1, type: 'formatState', payload: missing }).ok).toBe(false);
    expect(parseDocEngineEvent({ v: 1, type: 'formatState', payload: formatPayload({ editable: 'yes' }) }).ok).toBe(
      false,
    );
  });
});
