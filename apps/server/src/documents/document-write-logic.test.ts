import { describe, expect, it } from 'vitest';
import { planDocumentInsert, planDocumentSave } from './document-write-logic.js';

const IDLE_MS = 10 * 60 * 1000;

describe('planDocumentInsert', () => {
  it('delays digest when the user creates from the editor', () => {
    expect(
      planDocumentInsert({
        reason: 'create_user',
        blank: false,
        source: 'editor',
        idleDelayMs: IDLE_MS,
      }),
    ).toEqual({
      source: 'editor',
      status: 'pending',
      enqueueDigest: true,
      digestDelayMs: IDLE_MS,
      indexAfterInsert: false,
      resolveModel: true,
    });
  });

  it('digests a non-blank user create from other sources immediately and indexes it', () => {
    expect(
      planDocumentInsert({
        reason: 'create_user',
        blank: false,
        source: 'paste',
        idleDelayMs: IDLE_MS,
      }),
    ).toEqual({
      source: 'paste',
      status: 'pending',
      enqueueDigest: true,
      digestDelayMs: 0,
      indexAfterInsert: true,
      resolveModel: true,
    });
  });

  it('leaves a blank user create digested, without a digest job or an index', () => {
    expect(
      planDocumentInsert({
        reason: 'create_user',
        blank: true,
        source: 'editor',
        idleDelayMs: IDLE_MS,
      }),
    ).toEqual({
      source: 'editor',
      status: 'digested',
      enqueueDigest: false,
      digestDelayMs: 0,
      indexAfterInsert: false,
      resolveModel: false,
    });
  });

  it('marks a conversation create digested and does not enqueue digest', () => {
    expect(
      planDocumentInsert({
        reason: 'create_agent',
        blank: false,
        source: 'paste',
        idleDelayMs: IDLE_MS,
      }),
    ).toEqual({
      source: 'editor',
      status: 'digested',
      enqueueDigest: false,
      digestDelayMs: 0,
      indexAfterInsert: true,
      resolveModel: false,
    });
  });
});

describe('planDocumentSave', () => {
  it('does not enqueue digest when a conversation replaces the body', () => {
    expect(planDocumentSave('save_agent')).toEqual({
      digest: 'none',
      maySetPending: false,
      index: 'always',
    });
  });

  it('keeps user saves on planDigestOnSave and skips indexing while a digest is planned', () => {
    expect(planDocumentSave('save_user')).toEqual({
      digest: 'plan_on_save',
      maySetPending: true,
      index: 'unless_digest_planned',
    });
  });
});
