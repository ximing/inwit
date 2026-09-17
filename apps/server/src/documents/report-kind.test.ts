import { describe, expect, it } from 'vitest';
import { agentDocumentMetaLabel } from '@inwit/dto';

describe('explicit report classification', () => {
  it('keeps a renamed weekly report identifiable', () => {
    expect(agentDocumentMetaLabel('agent', '我的第一个星期', 'weekly_report')).toBe('AI 复盘');
  });
  it('does not classify a regular document by its title', () => {
    expect(agentDocumentMetaLabel('agent', '学习复盘的方法', 'document')).toBe('对比专题');
  });
});
