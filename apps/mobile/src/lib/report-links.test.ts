import { describe, expect, it, vi } from 'vitest';
import { resolveReportLink } from './report-links';

describe('weekly report card links', () => {
  it('opens the source document at the suggested card', async () => {
    const getCard = vi.fn().mockResolvedValue({ id: 'card', documentId: 'doc' });
    expect(await resolveReportLink('/cards/card', getCard)).toEqual({ kind: 'internal', pathname: '/docs/[id]', params: { id: 'doc', anchor: 'card' } });
    expect(getCard).toHaveBeenCalledWith('card');
  });
  it('opens review for a standalone card', async () => {
    expect(await resolveReportLink('/cards/card', vi.fn().mockResolvedValue({ documentId: null }))).toEqual({ kind: 'internal', pathname: '/review' });
  });
});
