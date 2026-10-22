import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { markDocumentDigested, markDocumentFailed, resetDocumentPipeline } from './document-status.js';

const DOC = '00000000-0000-4000-8000-000000000001';
const OTHER_DOC = '00000000-0000-4000-8000-000000000002';
const DONE = '00000000-0000-4000-8000-000000000003';
const TRASHED = '00000000-0000-4000-8000-000000000004';
const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000a2';
const STAMP = new Date('2020-01-01T00:00:00.000Z');

type DocRow = {
  id: string;
  userId: string;
  status: string;
  failReason: string | null;
  answer: string | null;
  linkHint: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
};

const rows: DocRow[] = [];

type Cmp = { key: string; op: 'eq' | 'ne' | 'isNull'; value?: unknown };

function columnKeys(table: object): Map<object, string> {
  const keyOf = new Map<object, string>();
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === 'object' && 'name' in value) keyOf.set(value, key);
  }
  return keyOf;
}

const columnKey = columnKeys(documents);

function collect(node: unknown, out: Cmp[]): void {
  if (!node || typeof node !== 'object') return;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return;
  const nested = chunks.filter(
    (chunk) => chunk && typeof chunk === 'object' && 'queryChunks' in (chunk as object),
  );
  if (nested.length > 0) {
    for (const chunk of nested) collect(chunk, out);
    return;
  }

  let key: string | undefined;
  let text = '';
  let value: unknown;
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue;
    if (columnKey.has(chunk)) {
      key = columnKey.get(chunk);
      continue;
    }
    const raw = (chunk as { value?: unknown }).value;
    if (Array.isArray(raw) && raw.every((part) => typeof part === 'string')) {
      text += raw.join('');
      continue;
    }
    if ('encoder' in chunk && 'value' in chunk) value = (chunk as { value: unknown }).value;
  }
  if (!key) return;
  if (text.includes('<>')) out.push({ key, op: 'ne', value });
  else if (text.includes('is null')) out.push({ key, op: 'isNull' });
  else if (text.includes('=')) out.push({ key, op: 'eq', value });
  else throw new Error(`unparsed predicate: ${JSON.stringify(text)}`);
}

function matches(row: DocRow, where: unknown): boolean {
  const cmps: Cmp[] = [];
  collect(where, cmps);
  if (cmps.length === 0) throw new Error('unparsed where');
  return cmps.every((cmp) => {
    const actual = row[cmp.key as keyof DocRow];
    if (cmp.op === 'eq') return actual === cmp.value;
    if (cmp.op === 'ne') return actual !== cmp.value;
    return actual == null;
  });
}

function createDb() {
  return {
    update(table: object) {
      if (table !== documents) throw new Error('unexpected table');
      return {
        set(values: Partial<DocRow>) {
          return {
            where(condition: unknown) {
              for (const row of rows) {
                if (!matches(row, condition)) continue;
                Object.assign(row, values);
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}

function seed(partial: Pick<DocRow, 'id' | 'userId' | 'status'> & Partial<DocRow>): DocRow {
  const row: DocRow = {
    failReason: null,
    answer: null,
    linkHint: null,
    deletedAt: null,
    updatedAt: STAMP,
    ...partial,
  };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows.length = 0;
  vi.mocked(getDb).mockReturnValue(createDb() as unknown as ReturnType<typeof getDb>);
});

describe('markDocumentDigested', () => {
  it('does not filter the success write by userId', async () => {
    const foreign = seed({
      id: DOC,
      userId: OTHER_USER,
      status: 'pending',
      failReason: 'old',
      answer: 'keep',
      linkHint: 'keep',
    });
    const otherDoc = seed({ id: OTHER_DOC, userId: USER, status: 'pending', failReason: 'stay' });
    const trashed = seed({
      id: TRASHED,
      userId: OTHER_USER,
      status: 'pending',
      failReason: 'stay',
      deletedAt: new Date(),
    });
    const digested = seed({
      id: DONE,
      userId: OTHER_USER,
      status: 'digested',
      answer: 'old',
      linkHint: 'old',
    });

    await markDocumentDigested(DOC);
    expect(foreign).toMatchObject({ status: 'digested', failReason: null, answer: 'keep', linkHint: 'keep' });
    expect(foreign.updatedAt.getTime()).toBeGreaterThan(STAMP.getTime());
    expect(otherDoc).toMatchObject({ status: 'pending', failReason: 'stay', updatedAt: STAMP });

    await markDocumentDigested(TRASHED);
    expect(trashed).toMatchObject({ status: 'pending', failReason: 'stay', updatedAt: STAMP });

    await markDocumentDigested(DONE, { answer: 'new' });
    expect(digested).toMatchObject({
      status: 'digested',
      failReason: null,
      answer: 'new',
      linkHint: 'old',
    });
  });

  it('writes answer and linkHint only when the caller includes those keys', async () => {
    const topic = seed({
      id: DOC,
      userId: USER,
      status: 'pending',
      failReason: 'x',
      answer: 'a',
      linkHint: 'h',
    });
    await markDocumentDigested(DOC);
    expect(topic).toMatchObject({ status: 'digested', failReason: null, answer: 'a', linkHint: 'h' });

    const digest = seed({
      id: OTHER_DOC,
      userId: OTHER_USER,
      status: 'failed',
      failReason: 'x',
      answer: 'a',
      linkHint: 'old',
    });
    await markDocumentDigested(OTHER_DOC, { linkHint: null });
    expect(digest).toMatchObject({ status: 'digested', failReason: null, answer: 'a', linkHint: null });

    const chat = seed({ id: DONE, userId: USER, status: 'pending', failReason: 'x', linkHint: 'old' });
    await markDocumentDigested(DONE, { answer: '回复', linkHint: 'hint' });
    expect(chat).toMatchObject({ status: 'digested', failReason: null, answer: '回复', linkHint: 'hint' });
  });
});

describe('markDocumentFailed', () => {
  it('does not overwrite a document that is already digested', async () => {
    const digested = seed({ id: DOC, userId: USER, status: 'digested', answer: 'kept' });
    const pending = seed({ id: OTHER_DOC, userId: USER, status: 'pending', answer: 'old' });
    const otherUser = seed({ id: DONE, userId: OTHER_USER, status: 'failed', failReason: 'keep' });
    const trashed = seed({
      id: TRASHED,
      userId: USER,
      status: 'pending',
      deletedAt: new Date(),
    });

    await markDocumentFailed(USER, DOC, 'late failure', { answer: 'should-not-land' });
    expect(digested).toMatchObject({ status: 'digested', failReason: null, answer: 'kept', updatedAt: STAMP });

    await markDocumentFailed(USER, OTHER_DOC, '  boom  ');
    expect(pending).toMatchObject({ status: 'failed', failReason: 'boom', answer: 'old' });

    await markDocumentFailed(USER, DONE, 'nope');
    expect(otherUser).toMatchObject({ status: 'failed', failReason: 'keep', updatedAt: STAMP });

    await markDocumentFailed(USER, TRASHED, 'nope');
    expect(trashed).toMatchObject({ status: 'pending', failReason: null, updatedAt: STAMP });
  });
});

describe('resetDocumentPipeline', () => {
  it('puts only a failed document back to pending', async () => {
    const failed = seed({ id: DOC, userId: USER, status: 'failed', failReason: 'boom' });
    const pending = seed({ id: OTHER_DOC, userId: USER, status: 'pending' });
    const digested = seed({ id: DONE, userId: USER, status: 'digested' });
    const otherUser = seed({ id: TRASHED, userId: OTHER_USER, status: 'failed', failReason: 'keep' });

    await resetDocumentPipeline(USER, DOC);
    expect(failed).toMatchObject({ status: 'pending', failReason: null });
    expect(failed.updatedAt.getTime()).toBeGreaterThan(STAMP.getTime());

    await resetDocumentPipeline(USER, OTHER_DOC);
    expect(pending).toMatchObject({ status: 'pending', failReason: null, updatedAt: STAMP });

    await resetDocumentPipeline(USER, DONE);
    expect(digested).toMatchObject({ status: 'digested', failReason: null, updatedAt: STAMP });

    await resetDocumentPipeline(USER, TRASHED);
    expect(otherUser).toMatchObject({ status: 'failed', failReason: 'keep', updatedAt: STAMP });
  });
});
