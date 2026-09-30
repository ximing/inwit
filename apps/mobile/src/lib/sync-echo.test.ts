import type { SyncChange } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { consumeEchoes } from './sync-echo';
import type { EchoStamp } from './sync-plan';

const DOC = '11111111-1111-4111-8111-111111111111';
const T2 = '2026-09-30T00:00:02.000Z';

function change(partial: Partial<SyncChange> & Pick<SyncChange, 'id'>): SyncChange {
  return {
    scope: 'document',
    resourceId: DOC,
    op: 'upsert',
    at: T2,
    ...partial,
  };
}

describe('consumeEchoes', () => {
  it('drops one stamp per consumed upsert and does not spend one on a delete', () => {
    const echoes: EchoStamp[] = [{ scope: 'document', resourceId: DOC, atMs: Date.parse(T2) }];
    const first = change({ id: '1' });
    const second = change({ id: '2' });
    const deleted = change({ id: '3', op: 'delete' });
    const kept = consumeEchoes([first, second, deleted], echoes);
    expect(kept).toEqual([second, deleted]);
    expect(echoes).toEqual([]);
    const again = consumeEchoes([change({ id: '4' })], echoes);
    expect(again).toEqual([change({ id: '4' })]);
  });

  it('does not spend a stamp on a change that was kept', () => {
    const echoes: EchoStamp[] = [{ scope: 'document', resourceId: DOC, atMs: Date.parse(T2) }];
    const older = change({ id: '1', at: '2026-09-30T00:00:01.000Z' });
    expect(consumeEchoes([older], echoes)).toEqual([older]);
    expect(echoes).toHaveLength(1);
  });
});
