import type { SyncChange } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { ReportsService } from './reports.service';
import { listWeeklyReports } from '@/api/reports';
import { getDocument } from '@/api/documents';

vi.mock('@/api/reports', () => ({ listWeeklyReports: vi.fn(), generateWeeklyReport: vi.fn() }));
vi.mock('@/api/documents', () => ({ getDocument: vi.fn() }));

describe('weekly report navigation', () => {
  it('appends older reports using the loaded count as offset', async () => {
    vi.mocked(listWeeklyReports).mockResolvedValueOnce({ items: [{ id: 'new' }], total: 2, limit: 20, offset: 0 } as never)
      .mockResolvedValueOnce({ items: [{ id: 'old' }], total: 2, limit: 20, offset: 1 } as never);
    const service = new ReportsService();
    await service.load();
    await service.loadMore();
    expect(service.reports.map(r => r.id)).toEqual(['new', 'old']);
    expect(listWeeklyReports).toHaveBeenLastCalledWith(1);
  });
  it('ignores a stale report response after navigating to another report', async () => {
    let resolveOld!: (doc: never) => void;
    vi.mocked(getDocument).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ id: 'new', kind: 'weekly_report' } as never);
    const service = new ReportsService();
    const old = service.open('old');
    await service.open('new');
    resolveOld({ id: 'old', kind: 'weekly_report' } as never);
    await old;
    expect(service.report?.id).toBe('new');
  });
  it('rejects a regular document opened as a report', async () => {
    vi.mocked(getDocument).mockResolvedValueOnce({ id: 'doc', kind: 'document' } as never);
    const service = new ReportsService();
    await service.open('doc');
    expect(service.report).toBeNull();
    expect(service.detailError).toBeTruthy();
  });

  it('refetches an open report when that document changes and ignores other rows', async () => {
    vi.mocked(getDocument).mockReset();
    vi.mocked(getDocument)
      .mockResolvedValueOnce({ id: 'rep', kind: 'weekly_report', title: 'old' } as never)
      .mockResolvedValueOnce({ id: 'rep', kind: 'weekly_report', title: 'new' } as never);
    const service = new ReportsService();
    await service.open('rep');
    await service.handleSync({
      type: 'changes',
      changes: [docChange('other'), docChange('rep', '2')],
    });
    expect(service.report?.title).toBe('new');
    expect(getDocument).toHaveBeenCalledTimes(2);

    await service.handleSync({
      type: 'changes',
      changes: [{ id: '3', scope: 'report', resourceId: null, op: 'upsert', at: AT }],
    });
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it('keeps the open report on a transient failure and drops it on 404', async () => {
    vi.mocked(getDocument)
      .mockResolvedValueOnce({ id: 'rep', kind: 'weekly_report', title: 'old' } as never)
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'missing'));
    const service = new ReportsService();
    service.reports = [{ id: 'rep' } as never];
    service.total = 1;
    await service.open('rep');
    await service.handleSync({ type: 'changes', changes: [docChange('rep')] });
    expect(service.report?.title).toBe('old');
    expect(service.detailError).toBeNull();
    await service.handleSync({ type: 'changes', changes: [docChange('rep', '9', 'delete')] });
    expect(service.report).toBeNull();
    expect(service.reports).toEqual([]);
    expect(service.total).toBe(0);
    expect(service.detailError).toBeTruthy();
  });

  it('reloads the list and the open report on reset', async () => {
    vi.mocked(getDocument).mockResolvedValue({ id: 'rep', kind: 'weekly_report', title: 'kept' } as never);
    vi.mocked(listWeeklyReports).mockResolvedValue({
      items: [{ id: 'rep' }],
      total: 1,
      limit: 20,
      offset: 0,
    } as never);
    const service = new ReportsService();
    await service.open('rep');
    await service.handleSync({ type: 'reset' });
    expect(listWeeklyReports).toHaveBeenCalledWith(0);
    expect(service.report?.title).toBe('kept');
    expect(service.reports.map((item) => item.id)).toEqual(['rep']);
  });
});

const AT = '2026-09-30T00:00:01.000Z';

function docChange(id: string, changeId = '1', op: SyncChange['op'] = 'upsert'): SyncChange {
  return { id: changeId, scope: 'document', resourceId: id, op, at: AT };
}
