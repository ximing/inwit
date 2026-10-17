import {
  commitConceptBatchInputSchema,
  conceptDraftSchema,
  conceptEvidenceLocatorSchema,
  createConceptInputSchema,
  knowledgeTargetSchema,
  saveConceptBundleInputSchema,
  conceptGraphViewInputSchema,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';

/** 200 个 code points，其中包含 astral 字符（UTF-16 下为 2 单位）。 */
function astralString(codePoints: number): string {
  return '𠮷'.repeat(codePoints);
}

const draftConcept = (tempId: string) => ({
  tempId,
  name: `概念${tempId}`,
  aliases: [],
  sense: null,
  definition: null,
  example: null,
  basis: 'explicit' as const,
  evidence: [],
  matchCandidates: [],
});

const draftRelation = (tempId: string, from: string, to: string) => ({
  tempId,
  fromRef: { kind: 'candidate' as const, tempId: from },
  toRef: { kind: 'candidate' as const, tempId: to },
  kind: 'other' as const,
  predicate: '关联',
  context: null,
  explanation: null,
  example: null,
  basis: 'explicit' as const,
  evidence: [],
});

describe('concept DTO schema', () => {
  it('字符串上限按 Unicode code points 计数', () => {
    const ok = createConceptInputSchema.safeParse({
      name: astralString(200),
      aliases: [],
      evidence: [],
    });
    expect(ok.success).toBe(true);
    const tooLong = createConceptInputSchema.safeParse({
      name: astralString(201),
      aliases: [],
      evidence: [],
    });
    expect(tooLong.success).toBe(false);
  });

  it('别名数量与单条长度受限', () => {
    const tooMany = createConceptInputSchema.safeParse({
      name: 'A',
      aliases: Array.from({ length: 11 }, (_, i) => `别名${i}`),
      evidence: [],
    });
    expect(tooMany.success).toBe(false);
  });

  it('证据定位判别联合不能混用字段', () => {
    const blockOk = conceptEvidenceLocatorSchema.safeParse({
      kind: 'block',
      blockIndex: 1,
      quote: '原文',
    });
    expect(blockOk.success).toBe(true);
    const mixed = conceptEvidenceLocatorSchema.safeParse({
      kind: 'block',
      blockIndex: 1,
      pageNumber: 3,
      quote: '原文',
    });
    expect(mixed.success).toBe(false);
    const unknownKind = conceptEvidenceLocatorSchema.safeParse({ kind: 'block2', quote: 'x' });
    expect(unknownKind.success).toBe(false);
  });

  it('练习/引用目标必须恰一非空', () => {
    expect(knowledgeTargetSchema.safeParse({ conceptId: crypto.randomUUID(), relationId: null }).success).toBe(true);
    expect(
      knowledgeTargetSchema.safeParse({
        conceptId: crypto.randomUUID(),
        relationId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(knowledgeTargetSchema.safeParse({ conceptId: null, relationId: null }).success).toBe(
      false,
    );
  });

  it('草稿第 31 个概念 / 第 61 条关系被拒绝', () => {
    const concepts = Array.from({ length: 31 }, (_, i) => draftConcept(`c${i}`));
    const tooManyConcepts = conceptDraftSchema.safeParse({
      schemaVersion: 1,
      concepts,
      relations: [],
    });
    expect(tooManyConcepts.success).toBe(false);

    const two = [draftConcept('a'), draftConcept('b')];
    const relations = Array.from({ length: 61 }, (_, i) => draftRelation(`r${i}`, 'a', 'b'));
    const tooManyRelations = conceptDraftSchema.safeParse({
      schemaVersion: 1,
      concepts: two,
      relations,
    });
    expect(tooManyRelations.success).toBe(false);
  });

  it('草稿拒绝重复 tempId、悬空引用与自环', () => {
    expect(
      conceptDraftSchema.safeParse({
        schemaVersion: 1,
        concepts: [draftConcept('a'), draftConcept('a')],
        relations: [],
      }).success,
    ).toBe(false);
    expect(
      conceptDraftSchema.safeParse({
        schemaVersion: 1,
        concepts: [draftConcept('a')],
        relations: [draftRelation('r1', 'a', 'ghost')],
      }).success,
    ).toBe(false);
    expect(
      conceptDraftSchema.safeParse({
        schemaVersion: 1,
        concepts: [draftConcept('a')],
        relations: [draftRelation('r1', 'a', 'a')],
      }).success,
    ).toBe(false);
    // 合法环（多节点）允许
    const cycle = conceptDraftSchema.safeParse({
      schemaVersion: 1,
      concepts: [draftConcept('a'), draftConcept('b'), draftConcept('c')],
      relations: [
        draftRelation('r1', 'a', 'b'),
        draftRelation('r2', 'b', 'c'),
        draftRelation('r3', 'c', 'a'),
      ],
    });
    expect(cycle.success).toBe(true);
  });

  it('提交命令：reuse 必须带目标与版本；重复决定被拒绝', () => {
    const missingTarget = commitConceptBatchInputSchema.safeParse({
      expectedDraftRevision: 1,
      conceptDecisions: [{ tempId: 'a', decision: 'reuse' }],
      relationDecisions: [],
      requestId: 'req-1',
    });
    expect(missingTarget.success).toBe(false);

    const dup = commitConceptBatchInputSchema.safeParse({
      expectedDraftRevision: 1,
      conceptDecisions: [
        { tempId: 'a', decision: 'create' },
        { tempId: 'a', decision: 'skip' },
      ],
      relationDecisions: [],
      requestId: 'req-1',
    });
    expect(dup.success).toBe(false);
  });

  it('graph/view 可见集合最多 50 个节点', () => {
    const ok = conceptGraphViewInputSchema.safeParse({
      nodeIds: Array.from({ length: 50 }, () => crypto.randomUUID()),
      expectedGraphRevision: 1,
    });
    expect(ok.success).toBe(true);
    const tooMany = conceptGraphViewInputSchema.safeParse({
      nodeIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
      expectedGraphRevision: 1,
    });
    expect(tooMany.success).toBe(false);
  });

  it('bundle 的方向与端点判别联合', () => {
    const parsed = saveConceptBundleInputSchema.safeParse({
      concept: { kind: 'create', name: '任务', aliases: [], evidence: [] },
      relations: [
        {
          direction: 'outgoing',
          other: { kind: 'create', name: '试次', aliases: [] },
          kind: 'composition',
          predicate: '包含',
          evidence: [],
        },
      ],
      requestId: 'req-bundle-1',
    });
    expect(parsed.success).toBe(true);
  });
});
