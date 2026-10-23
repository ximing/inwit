import { afterEach, describe, expect, it } from 'vitest';
import { endOfLocalDay, localDateKey, startOfLocalDay } from './date.js';

const savedTz = process.env.TZ;

/** 日历日，不看进程 TZ。en-CA 格式为 YYYY-MM-DD。 */
function shanghaiDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

describe('process local day', () => {
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it('TZ=UTC: 00:30 Asia/Shanghai is not the process today', () => {
    process.env.TZ = 'UTC';
    // 上海 00:30 = 前一日 16:30Z。UTC 进程的本地日不是上海的今天。
    const shanghaiHalf = new Date('2026-10-23T00:30:00+08:00');
    expect(shanghaiHalf.toISOString()).toBe('2026-10-22T16:30:00.000Z');
    expect(shanghaiHalf.getTimezoneOffset()).toBe(0);
    expect(shanghaiDateKey(shanghaiHalf)).toBe('2026-10-23');
    expect(localDateKey(shanghaiHalf)).toBe('2026-10-22');
    expect(localDateKey(shanghaiHalf)).not.toBe(shanghaiDateKey(shanghaiHalf));
    expect(startOfLocalDay(shanghaiHalf).toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(endOfLocalDay(shanghaiHalf).toISOString()).toBe('2026-10-22T23:59:59.999Z');

    // 00:30Z 是上海 08:30，日历日相同。UTC 日界因此落在上海 08:00，不是上海 0 点。
    const halfPastUtc = new Date('2026-10-23T00:30:00.000Z');
    expect(localDateKey(halfPastUtc)).toBe(shanghaiDateKey(halfPastUtc));
    expect(localDateKey(halfPastUtc)).toBe('2026-10-23');
    expect(startOfLocalDay(halfPastUtc).toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(startOfLocalDay(halfPastUtc).getTime()).not.toBe(new Date('2026-10-23T00:00:00+08:00').getTime());
  });
});
