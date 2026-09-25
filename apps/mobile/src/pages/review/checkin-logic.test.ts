import { describe, expect, it } from 'vitest';
import { buildCheckinGrid, checkinLevel, countsByDate, shiftMonthKey } from './checkin-logic';

describe('checkinLevel', () => {
  it('buckets 0, 1–4, 5–8, and 9+', () => {
    expect(checkinLevel(0)).toBe(0);
    expect(checkinLevel(1)).toBe(1);
    expect(checkinLevel(4)).toBe(1);
    expect(checkinLevel(5)).toBe(2);
    expect(checkinLevel(8)).toBe(2);
    expect(checkinLevel(9)).toBe(3);
  });
});

describe('buildCheckinGrid', () => {
  it('starts on Monday and does not add an empty week after a full past month', () => {
    const grid = buildCheckinGrid({
      month: '2024-01',
      counts: { '2024-01-01': 4, '2024-01-31': 9 },
      today: new Date(2026, 8, 25),
    });
    expect(grid.cells[0]).toMatchObject({ kind: 'day', day: 1, level: 1 });
    expect(grid.cells.filter((cell) => cell.kind === 'day')).toHaveLength(31);
    expect(grid.cells.filter((cell) => cell.kind === 'trail').length).toBeLessThan(7);
    expect(grid.cells).toHaveLength(35);
    expect(grid.checkinDays).toBe(2);
    expect(grid.canGoForward).toBe(true);
  });

  it('pads a Sunday-start month with six Monday-first blanks', () => {
    const grid = buildCheckinGrid({
      month: '2024-09',
      counts: {},
      today: new Date(2026, 8, 25),
    });
    expect(grid.cells.filter((cell) => cell.kind === 'lead')).toHaveLength(6);
    expect(grid.cells.filter((cell) => cell.kind === 'day')).toHaveLength(30);
    expect(grid.cells).toHaveLength(42);
    expect(grid.cells.filter((cell) => cell.kind === 'trail').length).toBeLessThan(7);
  });

  it('stops the current month at today and marks that cell', () => {
    const today = new Date(2026, 8, 25);
    const grid = buildCheckinGrid({
      month: '2026-09',
      counts: { '2026-09-25': 9, '2026-09-30': 3 },
      today,
    });
    const days = grid.cells.filter((cell) => cell.kind === 'day');
    expect(days).toHaveLength(25);
    expect(days.some((cell) => cell.kind === 'day' && cell.day > 25)).toBe(false);
    expect(days.find((cell) => cell.kind === 'day' && cell.day === 25)).toMatchObject({
      isToday: true,
      level: 3,
    });
    expect(grid.checkinDays).toBe(1);
    expect(grid.canGoForward).toBe(false);
    expect(grid.cells.filter((cell) => cell.kind === 'lead')).toHaveLength(1);
    expect(grid.cells).toHaveLength(28);
  });

  it('does not build a future month', () => {
    const grid = buildCheckinGrid({
      month: '2026-10',
      counts: { '2026-10-01': 2 },
      today: new Date(2026, 8, 25),
    });
    expect(grid.cells).toEqual([]);
    expect(grid.canGoForward).toBe(false);
  });
});

describe('month helpers', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('indexes check-in counts by date', () => {
    expect(countsByDate([{ date: '2026-09-01', count: 2 }])).toEqual({ '2026-09-01': 2 });
  });
});
