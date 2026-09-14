import { describe, expect, it } from 'vitest';
import { TOPIC_SUGGESTION_MIN_DOCS, topicJobPayloadSchema } from '@inwit/dto';
import {
  SUGGEST_DISMISS_MS,
  SUGGEST_EXPIRE_MS,
  decideSuggestionWrite,
  documentOverlap,
  normalizeSuggestionTitle,
  slugifySuggestionTitle,
  suggestionKeyFromSlug,
  titlesOverlap,
  type SuggestionMemoryView,
} from './suggest-logic.js';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];

function view(partial: Partial<SuggestionMemoryView> & Pick<SuggestionMemoryView, 'key' | 'title' | 'status'>): SuggestionMemoryView {
  return {
    documentIds: ids.slice(0, 4),
    dismissedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('topicJobPayloadSchema suggest', () => {
  it('accepts suggest without topicId', () => {
    const parsed = topicJobPayloadSchema.safeParse({ action: 'suggest' });
    expect(parsed.success).toBe(true);
  });

  it('still requires topicId for organize/fill', () => {
    expect(topicJobPayloadSchema.safeParse({ action: 'organize' }).success).toBe(false);
    expect(topicJobPayloadSchema.safeParse({ action: 'fill', topicId: ids[0] }).success).toBe(false);
    expect(
      topicJobPayloadSchema.safeParse({ action: 'organize', topicId: ids[0] }).success,
    ).toBe(true);
  });
});

describe('slugify / titles', () => {
  it('slugifies latin titles to kebab-case', () => {
    expect(slugifySuggestionTitle('Rust Ownership')).toBe('rust-ownership');
    expect(suggestionKeyFromSlug('rust-ownership')).toBe('topic_suggestion_rust-ownership');
  });

  it('falls back to topic-<hash> for CJK-only titles', () => {
    const slug = slugifySuggestionTitle('所有权与生命周期');
    expect(slug.startsWith('topic-')).toBe(true);
    expect(slug.length).toBeGreaterThan(6);
  });

  it('normalizes and overlaps titles', () => {
    expect(normalizeSuggestionTitle('Rust 所有权')).toBe('rust所有权');
    expect(titlesOverlap('Rust 所有权', 'Rust 所有权与生命周期')).toBe(true);
    expect(titlesOverlap('Rust 所有权', '摄影构图')).toBe(false);
  });

  it('counts document overlap', () => {
    expect(documentOverlap(ids.slice(0, 4), ids.slice(1, 5))).toBe(3);
    expect(documentOverlap(ids.slice(0, 2), ids.slice(3))).toBe(0);
  });
});

describe('decideSuggestionWrite', () => {
  const now = new Date('2026-09-14T00:00:00.000Z');
  const base = {
    title: 'Rust 所有权',
    slug: 'rust-ownership',
    documentIds: ids.slice(0, 4),
    now,
    existing: [] as SuggestionMemoryView[],
    activeTopicTitles: [] as string[],
  };

  it('requires at least 4 documents', () => {
    const decision = decideSuggestionWrite({ ...base, documentIds: ids.slice(0, 3) });
    expect(decision.ok).toBe(false);
    expect(TOPIC_SUGGESTION_MIN_DOCS).toBe(4);
  });

  it('rejects when an active topic already covers the cluster', () => {
    const decision = decideSuggestionWrite({
      ...base,
      activeTopicTitles: ['Rust 所有权与生命周期'],
    });
    expect(decision).toEqual({ ok: false, reason: 'active topic already covers this cluster' });
  });

  it('rejects a pending suggestion with the same key', () => {
    const decision = decideSuggestionWrite({
      ...base,
      existing: [view({ key: 'topic_suggestion_rust-ownership', title: 'Rust 所有权', status: 'pending', createdAt: now })],
    });
    expect(decision).toEqual({ ok: false, reason: 'already pending' });
  });

  it('rejects a dismissed suggestion within 30 days even with a different slug', () => {
    const dismissedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const decision = decideSuggestionWrite({
      ...base,
      slug: 'rust-lifetimes',
      existing: [
        view({
          key: 'topic_suggestion_rust-ownership',
          title: 'Rust 所有权',
          status: 'dismissed',
          dismissedAt,
          createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        }),
      ],
    });
    expect(decision).toEqual({ ok: false, reason: 'dismissed recently' });
  });

  it('allows re-proposal after the 30-day dismiss window', () => {
    const dismissedAt = new Date(now.getTime() - SUGGEST_DISMISS_MS - 1000).toISOString();
    const decision = decideSuggestionWrite({
      ...base,
      existing: [
        view({
          key: 'topic_suggestion_rust-ownership',
          title: 'Rust 所有权',
          status: 'dismissed',
          dismissedAt,
          createdAt: new Date(now.getTime() - SUGGEST_DISMISS_MS - 2000),
        }),
      ],
    });
    expect(decision).toEqual({ ok: true });
  });

  it('treats an expired pending suggestion as dismissed for the cooldown', () => {
    const createdAt = new Date(now.getTime() - SUGGEST_EXPIRE_MS - 2 * 24 * 60 * 60 * 1000);
    const decision = decideSuggestionWrite({
      ...base,
      existing: [view({ key: 'topic_suggestion_rust-ownership', title: 'Rust 所有权', status: 'pending', createdAt })],
    });
    expect(decision).toEqual({ ok: false, reason: 'dismissed recently' });
  });

  it('rejects overlapping document ids as the same cluster', () => {
    const decision = decideSuggestionWrite({
      ...base,
      slug: 'something-else',
      title: '完全不同的标题xyz',
      existing: [
        view({
          key: 'topic_suggestion_other',
          title: '别的主题',
          status: 'accepted',
          documentIds: ids.slice(0, 4),
        }),
      ],
    });
    expect(decision).toEqual({ ok: false, reason: 'already accepted' });
  });
});
