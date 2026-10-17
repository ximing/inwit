import { describe, expect, it } from 'vitest';
import {
  conceptMatchKind,
  evidenceDedupeHash,
  graphViewScopeHash,
  normalizeConceptName,
  relationIdentityHash,
  requestHashOf,
  stableStringify,
} from './concept-identity.js';

describe('normalizeConceptName', () => {
  it('NFKC、去首尾空白、连续空白折叠、小写；不改变存储展示名', () => {
    expect(normalizeConceptName('  Trial　Design ')).toBe('trial design');
    expect(normalizeConceptName('Ｔａｓｋ')).toBe('task');
    expect(normalizeConceptName('多  次\n\t执行')).toBe('多 次 执行');
    expect(normalizeConceptName('A/B（实验）')).toBe('a/b(实验)');
  });
});

describe('conceptMatchKind', () => {
  const existing = {
    id: 'c1',
    name: 'Trial',
    sense: null,
    aliases: ['试次', '单次试验'],
  };

  it('同名（忽略大小写与空白）命中 name', () => {
    expect(conceptMatchKind({ name: ' trial ', aliases: [] }, existing)).toBe('name');
  });

  it('别名相交命中 alias；不同名不命中', () => {
    expect(conceptMatchKind({ name: '实验', aliases: ['试次'] }, existing)).toBe('alias');
    expect(conceptMatchKind({ name: '实验', aliases: [] }, existing)).toBeNull();
    // 输入别名与已有名称相交
    expect(conceptMatchKind({ name: 'X', aliases: ['trial'] }, existing)).toBe('alias');
  });
});

describe('relationIdentityHash', () => {
  const base = {
    userId: 'u1',
    topicId: 't1',
    fromConceptId: 'a',
    toConceptId: 'b',
    kind: 'composition',
    predicate: '包含',
    context: '实验设计',
  };

  it('规范化后的谓词/语境产生相同哈希；不同语境保留不同身份', () => {
    const h1 = relationIdentityHash(base);
    const h2 = relationIdentityHash({ ...base, predicate: ' 包含 ' });
    const h3 = relationIdentityHash({ ...base, context: ' 实验设计 ' });
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
    const other = relationIdentityHash({ ...base, context: '另一框架' });
    expect(other).not.toBe(h1);
  });

  it('方向是身份的一部分', () => {
    const reversed = relationIdentityHash({
      ...base,
      fromConceptId: 'b',
      toConceptId: 'a',
    });
    expect(reversed).not.toBe(relationIdentityHash(base));
  });
});

describe('stableStringify / requestHashOf', () => {
  it('对象键序无关，数组有序', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(requestHashOf({ x: { y: [1, { z: 2, w: 3 }] } })).toBe(
      requestHashOf({ x: { y: [1, { w: 3, z: 2 }] } }),
    );
  });
});

describe('evidenceDedupeHash / graphViewScopeHash', () => {
  it('同目标同定位同引文哈希一致；目标不同则不同', () => {
    const locator = { kind: 'block' as const, blockIndex: 2, quote: '引文' };
    const h1 = evidenceDedupeHash({
      targetKind: 'concept',
      targetId: 'c1',
      documentId: 'd1',
      documentHash: 'h',
      locator,
    });
    const h2 = evidenceDedupeHash({
      targetKind: 'concept',
      targetId: 'c2',
      documentId: 'd1',
      documentHash: 'h',
      locator,
    });
    expect(h1).not.toBe(h2);
  });

  it('可见集合哈希与节点顺序无关', () => {
    const a = graphViewScopeHash({ userId: 'u', topicId: 't', documentId: null, nodeIds: ['1', '2'] });
    const b = graphViewScopeHash({ userId: 'u', topicId: 't', documentId: null, nodeIds: ['2', '1'] });
    expect(a).toBe(b);
  });
});
