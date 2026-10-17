import { describe, expect, it } from 'vitest';
import {
  acknowledge,
  buildCommitPlan,
  chooseConcept,
  chooseRelation,
  defaultChoiceState,
  rebindRelation,
  relationChosen,
  type DraftChoiceState,
} from './concept-selection-logic.js';
import type { ConceptDraft } from '@inwit/dto';

function concept(tempId: string, basis: 'explicit' | 'inferred' = 'explicit') {
  return {
    tempId,
    name: tempId,
    aliases: [],
    sense: null,
    definition: null,
    example: null,
    basis,
    evidence: [],
    matchCandidates: [],
  };
}

function relation(
  tempId: string,
  from: string,
  to: string,
  basis: 'explicit' | 'inferred' = 'explicit',
): ConceptDraft['relations'][number] {
  return {
    tempId,
    fromRef: { kind: 'candidate', tempId: from },
    toRef: { kind: 'candidate', tempId: to },
    kind: 'other',
    predicate: '关联',
    context: null,
    explanation: null,
    example: null,
    basis,
    evidence: [],
  };
}

const draft: ConceptDraft = {
  schemaVersion: 1,
  concepts: [concept('a'), concept('b'), concept('c', 'inferred')],
  relations: [relation('r1', 'a', 'b'), relation('r2', 'b', 'c', 'inferred')],
};

describe('concept-selection-logic', () => {
  it('推断项默认不选，显式项默认勾选', () => {
    const state = defaultChoiceState(draft);
    expect(state.concepts['c']).toEqual({ kind: 'skip' });
    expect(state.relations['r1']).toBe(true);
    expect(state.relations['r2']).toBe(false);
  });

  it('取消节点自动取消依赖关系；重绑定后可保留', () => {
    let state = defaultChoiceState(draft);
    state = chooseConcept(draft, state, 'b', { kind: 'skip' });
    expect(state.relations['r1']).toBe(false);
    expect(relationChosen(draft, state, 'r1')).toBe(false);

    // 重绑定 r1 的 to 端到已有概念后可勾选
    const existing = { kind: 'existing' as const, conceptId: crypto.randomUUID(), version: 1 };
    state = rebindRelation(state, 'r1', { toRef: existing });
    state = chooseRelation(state, 'r1', true);
    expect(relationChosen(draft, state, 'r1')).toBe(true);
  });

  it('inferred 勾选必须确认，否则列入 unconfirmedInferred', () => {
    let state = defaultChoiceState(draft);
    state = chooseConcept(draft, state, 'c', { kind: 'create' });
    state = chooseRelation(state, 'r2', true);
    let plan = buildCommitPlan(draft, state);
    expect(plan.unconfirmedInferred).toContain('c');
    expect(plan.unconfirmedInferred).toContain('r2');

    state = acknowledge(state, 'c');
    state = acknowledge(state, 'r2');
    plan = buildCommitPlan(draft, state);
    expect(plan.unconfirmedInferred).toHaveLength(0);
    expect(plan.conceptDecisions.find((d) => d.tempId === 'c')?.acknowledged).toBe(true);
    expect(plan.relationDecisions.find((d) => d.tempId === 'r2')?.acknowledged).toBe(true);
  });

  it('reuse 决定携带版本与说明；跳过项不进提交', () => {
    const state: DraftChoiceState = {
      ...defaultChoiceState(draft),
      concepts: {
        a: { kind: 'reuse', conceptId: crypto.randomUUID(), version: 3, note: '补充' },
        b: { kind: 'skip' },
        c: { kind: 'skip' },
      },
    };
    const plan = buildCommitPlan(draft, state);
    expect(plan.conceptDecisions).toHaveLength(1);
    expect(plan.conceptDecisions[0]).toMatchObject({
      tempId: 'a',
      decision: 'reuse',
      reuseExpectedVersion: 3,
      note: '补充',
    });
    // b 被跳过 → r1 无效（to 端缺失）
    expect(plan.relationDecisions).toHaveLength(0);
  });
});
