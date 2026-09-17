import { ANNOTATION_RESURFACE_MAX_ITEMS } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  isConvertedLoose,
  normalizeResurfaceKey,
  parseResurfaceContent,
  pickResurfaceAnnotations,
  resurfaceKeyForDate,
  resurfaceTerminalStatus,
  RESURFACE_AGE_MS,
  type CandidateCardHint,
  type ResurfaceCandidate,
} from './resurface-logic.js';

const NOW = new Date('2026-09-17T08:00:00Z');
const OLD = new Date(NOW.getTime() - RESURFACE_AGE_MS - 24 * 60 * 60 * 1000);
const FRESH = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

function candidate(overrides: Partial<ResurfaceCandidate> = {}): ResurfaceCandidate {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    quote: '一段原文',
    note: '一句想法',
    imageKey: null,
    anchorBlockIndex: null,
    createdAt: OLD,
    ...overrides,
  };
}

function cardHint(overrides: Partial<CandidateCardHint> = {}): CandidateCardHint {
  return {
    documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    imageKey: null,
    anchorBlockIndex: null,
    anchorText: null,
    ...overrides,
  };
}

describe('normalizeResurfaceKey', () => {
  it('accepts a full key or a bare date, rejects garbage', () => {
    expect(normalizeResurfaceKey('annotation_resurface_2026-09-17')).toBe(
      'annotation_resurface_2026-09-17',
    );
    expect(normalizeResurfaceKey('2026-09-17')).toBe(resurfaceKeyForDate('2026-09-17'));
    expect(normalizeResurfaceKey('annotation_resurface_09-17')).toBeNull();
    expect(normalizeResurfaceKey('not-a-key')).toBeNull();
  });
});

describe('parseResurfaceContent', () => {
  it('round-trips a valid content and rejects malformed ones', () => {
    const content = {
      annotationIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      status: 'pending' as const,
    };
    expect(parseResurfaceContent(content)).toEqual(content);
    expect(parseResurfaceContent({ annotationIds: [], status: 'pending' })).toBeNull();
    expect(parseResurfaceContent({ annotationIds: ['nope'], status: 'pending' })).toBeNull();
    expect(parseResurfaceContent(null)).toBeNull();
  });
});

describe('isConvertedLoose', () => {
  it('matches by shared excerpt image on the same document', () => {
    const c = candidate({ imageKey: 'docs/u/d/excerpts/x.png' });
    expect(isConvertedLoose(c, cardHint({ imageKey: 'docs/u/d/excerpts/x.png' }))).toBe(true);
    expect(isConvertedLoose(c, cardHint({ imageKey: 'docs/u/d/excerpts/y.png' }))).toBe(false);
  });

  it('matches by block index + verbatim quote on the same document', () => {
    const c = candidate({ anchorBlockIndex: 3, quote: '梯度逐层衰减' });
    expect(isConvertedLoose(c, cardHint({ anchorBlockIndex: 3, anchorText: '梯度逐层衰减' }))).toBe(true);
    expect(isConvertedLoose(c, cardHint({ anchorBlockIndex: 4, anchorText: '梯度逐层衰减' }))).toBe(false);
    expect(isConvertedLoose(c, cardHint({ anchorBlockIndex: 3, anchorText: '改过的引文' }))).toBe(false);
  });

  it('never matches cards from another document', () => {
    const c = candidate({ imageKey: 'docs/u/d/excerpts/x.png' });
    expect(
      isConvertedLoose(c, cardHint({ documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', imageKey: 'docs/u/d/excerpts/x.png' })),
    ).toBe(false);
  });
});

describe('pickResurfaceAnnotations', () => {
  it('keeps only old, noted, unsuggested, unconverted annotations, oldest first, capped', () => {
    const base = 'bbbbbbbb-bbbb-4bbb-8bbb-';
    const mk = (n: number, createdAt: Date) =>
      candidate({ id: `${base}${String(n).padStart(12, '0')}`, createdAt });
    const candidates = [
      mk(1, new Date(OLD.getTime() - 1000)),
      mk(2, OLD),
      mk(3, new Date(OLD.getTime() + 1000)),
      mk(4, new Date(OLD.getTime() + 2000)),
      mk(5, new Date(OLD.getTime() + 3000)),
      candidate({ id: `${base}${String(6).padStart(12, '0')}`, createdAt: FRESH }),
      candidate({ id: `${base}${String(7).padStart(12, '0')}`, createdAt: OLD, note: '   ' }),
    ];
    const picked = pickResurfaceAnnotations({
      candidates,
      cardHints: [],
      suggestedIds: new Set([`${base}${String(2).padStart(12, '0')}`]),
      now: NOW,
    });
    expect(picked.map((row) => row.id)).toEqual([
      `${base}${String(1).padStart(12, '0')}`,
      `${base}${String(3).padStart(12, '0')}`,
      `${base}${String(4).padStart(12, '0')}`,
    ]);
    expect(picked.length).toBe(ANNOTATION_RESURFACE_MAX_ITEMS);
  });

  it('excludes annotations loosely converted by an existing card', () => {
    const c = candidate({ anchorBlockIndex: 2, quote: '原句' });
    const picked = pickResurfaceAnnotations({
      candidates: [c],
      cardHints: [cardHint({ anchorBlockIndex: 2, anchorText: '原句' })],
      suggestedIds: new Set(),
      now: NOW,
    });
    expect(picked).toEqual([]);
  });
});

describe('resurfaceTerminalStatus', () => {
  it('is accepted once any card was created, dismissed otherwise', () => {
    expect(
      resurfaceTerminalStatus({
        annotationIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        status: 'pending',
        acceptedCardIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      }),
    ).toBe('accepted');
    expect(
      resurfaceTerminalStatus({
        annotationIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        status: 'pending',
      }),
    ).toBe('dismissed');
  });
});
