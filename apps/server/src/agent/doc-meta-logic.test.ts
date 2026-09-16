import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_AGENT_TITLE_MAX,
  DOCUMENT_DESCRIPTION_MAX,
  clipChars,
  documentMetaUserPrompt,
  isEmptyMetaPatch,
  isTooShortForDocumentMeta,
  isUserOwnedTitle,
  needsDocumentMeta,
  normalizeAgentDescription,
  normalizeAgentTitle,
  parseDocumentMetaProposal,
  resolveDocumentMetaPatch,
} from './doc-meta-logic.js';

describe('normalizeAgentTitle', () => {
  it('clips to 20 unicode chars and collapses whitespace', () => {
    expect(normalizeAgentTitle('  梯度   消失  ')).toBe('梯度 消失');
    expect(normalizeAgentTitle('a'.repeat(30))).toBe('a'.repeat(DOCUMENT_AGENT_TITLE_MAX));
    expect(normalizeAgentTitle('「残差连接」')).toBe('残差连接');
  });

  it('treats empty, non-string, and 未命名文档 as null', () => {
    expect(normalizeAgentTitle('')).toBeNull();
    expect(normalizeAgentTitle('   ')).toBeNull();
    expect(normalizeAgentTitle(null)).toBeNull();
    expect(normalizeAgentTitle(12)).toBeNull();
    expect(normalizeAgentTitle('未命名文档')).toBeNull();
  });
});

describe('normalizeAgentDescription', () => {
  it('clips to 60 unicode chars', () => {
    expect(normalizeAgentDescription('讲梯度消失。')).toBe('讲梯度消失。');
    expect(normalizeAgentDescription('字'.repeat(80))).toBe('字'.repeat(DOCUMENT_DESCRIPTION_MAX));
    expect(normalizeAgentDescription('  \n  ')).toBeNull();
    expect(normalizeAgentDescription(undefined)).toBeNull();
  });
});

describe('isUserOwnedTitle / needsDocumentMeta', () => {
  it('treats empty and 未命名文档 as replaceable', () => {
    expect(isUserOwnedTitle(null)).toBe(false);
    expect(isUserOwnedTitle('')).toBe(false);
    expect(isUserOwnedTitle('  未命名文档  ')).toBe(false);
    expect(isUserOwnedTitle('梯度消失')).toBe(true);
  });

  it('needs meta when title is replaceable or description is empty', () => {
    expect(needsDocumentMeta({ title: null, description: null })).toBe(true);
    expect(needsDocumentMeta({ title: '未命名文档', description: '已有摘要' })).toBe(true);
    expect(needsDocumentMeta({ title: '导入的讲义', description: null })).toBe(true);
    expect(needsDocumentMeta({ title: '导入的讲义', description: '已有摘要' })).toBe(false);
  });
});

describe('resolveDocumentMetaPatch', () => {
  it('writes title+description when title is empty', () => {
    expect(
      resolveDocumentMetaPatch({
        existingTitle: null,
        existingDescription: null,
        proposedTitle: '梯度消失',
        proposedDescription: '讲深层网络里梯度逐层变小。',
      }),
    ).toEqual({
      title: '梯度消失',
      description: '讲深层网络里梯度逐层变小。',
    });
  });

  it('replaces 未命名文档 but not a real user title', () => {
    expect(
      resolveDocumentMetaPatch({
        existingTitle: '未命名文档',
        existingDescription: null,
        proposedTitle: '残差连接',
        proposedDescription: '讲 shortcut 如何给梯度开近道。',
      }).title,
    ).toBe('残差连接');
    expect(
      resolveDocumentMetaPatch({
        existingTitle: '我改过的标题',
        existingDescription: null,
        proposedTitle: '残差连接',
        proposedDescription: '讲 shortcut。',
      }),
    ).toEqual({ description: '讲 shortcut。' });
  });

  it('does not overwrite an existing description', () => {
    expect(
      resolveDocumentMetaPatch({
        existingTitle: null,
        existingDescription: '已有摘要',
        proposedTitle: '新标题',
        proposedDescription: '新摘要',
      }),
    ).toEqual({ title: '新标题' });
  });

  it('returns empty patch when agent has nothing to say', () => {
    const patch = resolveDocumentMetaPatch({
      existingTitle: null,
      existingDescription: null,
      proposedTitle: '',
      proposedDescription: null,
    });
    expect(isEmptyMetaPatch(patch)).toBe(true);
  });
});

describe('parseDocumentMetaProposal', () => {
  it('parses fenced JSON and strips trailing prose', () => {
    expect(
      parseDocumentMetaProposal('```json\n{"title":"过拟合","description":"讲模型记样本。"}\n```'),
    ).toEqual({ title: '过拟合', description: '讲模型记样本。' });
    expect(
      parseDocumentMetaProposal('好的。\n{"title":"BN","description":"稳住激活。"} 完'),
    ).toEqual({ title: 'BN', description: '稳住激活。' });
  });

  it('falls back to empty fields on garbage', () => {
    expect(parseDocumentMetaProposal('not json')).toEqual({
      title: undefined,
      description: undefined,
    });
    expect(parseDocumentMetaProposal('[]')).toEqual({
      title: undefined,
      description: undefined,
    });
  });
});

describe('isTooShortForDocumentMeta', () => {
  it('treats blank / tiny notes as too short', () => {
    expect(isTooShortForDocumentMeta('')).toBe(true);
    expect(isTooShortForDocumentMeta('# hi')).toBe(true);
    expect(isTooShortForDocumentMeta('梯度消失是深层网络训练中的问题。')).toBe(false);
  });
});

describe('documentMetaUserPrompt', () => {
  it('asks to keep an existing title', () => {
    const prompt = documentMetaUserPrompt({
      contentMd: '正文',
      keepTitle: true,
      existingTitle: '手改标题',
    });
    expect(prompt).toContain('手改标题');
    expect(prompt).toContain('title 必须输出 null');
  });
});

describe('clipChars', () => {
  it('counts unicode code points', () => {
    expect(clipChars('梯度消失🎉多余', 5)).toBe('梯度消失🎉');
  });
});
