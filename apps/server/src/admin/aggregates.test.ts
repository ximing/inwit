import { describe, expect, it } from 'vitest';
import {
  asNumber,
  elapsedMs,
  fillDailySeries,
  previewText,
  roundCost,
  usageWindow,
  utcDateKey,
} from './aggregates.js';

describe('asNumber', () => {
  it('coerces numeric strings and rejects junk', () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber('1.25')).toBe(1.25);
    expect(asNumber('')).toBe(0);
    expect(asNumber(null)).toBe(0);
  });
});

describe('roundCost', () => {
  it('keeps 8 decimal places', () => {
    expect(roundCost(0.123456789)).toBe(0.12345679);
  });
});

describe('usageWindow + fillDailySeries', () => {
  it('fills missing UTC days with zeros, inclusive of today', () => {
    const now = new Date('2026-09-14T08:15:00.000Z');
    const { from, to } = usageWindow(5, now);
    expect(utcDateKey(from)).toBe('2026-09-10');
    expect(utcDateKey(to)).toBe('2026-09-14');

    const filled = fillDailySeries(from, 5, [
      {
        date: '2026-09-12',
        calls: 2,
        totalTokens: 40,
        costEstimate: 0.01,
        chatTokens: 30,
        embedTokens: 10,
        rerankTokens: 0,
        ocrTokens: 0,
      },
    ]);
    expect(filled.map((row) => row.date)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(filled[2]?.totalTokens).toBe(40);
    expect(filled[0]?.totalTokens).toBe(0);
  });
});

describe('elapsedMs', () => {
  const start = new Date('2026-09-14T10:00:00.000Z');

  it('uses finishedAt when present', () => {
    expect(elapsedMs(start, new Date('2026-09-14T10:00:01.500Z'), false)).toBe(1500);
  });

  it('uses now for a still-running execution', () => {
    expect(elapsedMs(start, null, true, new Date('2026-09-14T10:00:03.000Z'))).toBe(3000);
  });

  it('is null when not running and not finished', () => {
    expect(elapsedMs(start, null, false)).toBeNull();
  });
});

describe('previewText', () => {
  it('collapses whitespace and truncates', () => {
    expect(previewText('  hello   world  ', 8)).toBe('hello wo…');
    expect(previewText('   ')).toBeNull();
  });
});
