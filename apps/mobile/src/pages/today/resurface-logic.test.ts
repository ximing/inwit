import type { AnnotationResurface } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  resurfaceAfterAccept,
  resurfaceAfterDismiss,
  resurfaceAfterLoad,
  resurfacePrompt,
} from './resurface-logic';

function prompt(title: string | null, count = 2): AnnotationResurface {
  return {
    key: 'annotation_resurface_2026-09-01',
    status: 'pending',
    createdAt: '2026-09-01T00:00:00.000Z',
    annotations: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${String(index + 1)}`,
      documentId: '11111111-1111-4111-8111-111111111111',
      documentTitle: index === 0 ? title : '另一篇',
      kind: 'text' as const,
      quote: '引用',
      note: '',
      pageIndex: null,
    })),
  };
}

describe('resurface prompt', () => {
  it('shows the count and the first document title', () => {
    const view = resurfacePrompt(prompt('线性代数'));
    expect(view.visible).toBe(true);
    expect(view.count).toBe(2);
    expect(view.documentTitle).toBe('线性代数');
    expect(view.subtitle).toBe('你有 2 条两周前的批注还没消化成卡片，比如《线性代数》里的那条。');
  });

  it('omits the example when the first item has no title', () => {
    expect(resurfacePrompt(prompt(null, 1)).subtitle).toBe('你有 1 条两周前的批注还没消化成卡片。');
  });

  it('hides after load, accept, dismiss, and a null sync payload', () => {
    expect(resurfaceAfterLoad(null)).toBeNull();
    expect(resurfaceAfterLoad(prompt('笔记'))?.key).toBe('annotation_resurface_2026-09-01');
    expect(resurfaceAfterAccept(null)).toBeNull();
    expect(resurfaceAfterAccept(prompt('笔记', 1))?.annotations).toHaveLength(1);
    expect(resurfaceAfterDismiss()).toBeNull();
    expect(resurfacePrompt(resurfaceAfterLoad(null)).visible).toBe(false);
  });
});
