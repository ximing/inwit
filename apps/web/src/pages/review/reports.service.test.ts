import { describe, expect, it, vi } from 'vitest';
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
});
