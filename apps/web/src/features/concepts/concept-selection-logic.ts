import type { ConceptDraft, ConceptDecision, RelationDecision, ConceptDraftRef } from '@inwit/dto';

/**
 * 候选勾选与提交的纯逻辑（T7）：决定状态只描述意图，提交输入由服务端再校验。
 * - 推断项默认不勾选；
 * - 取消候选节点时，依赖它的关系默认取消，也可重绑定到已有概念；
 * - 同名异义不被静默合并（reuse 必须显式选择）。
 */

export type ConceptChoice =
  | { kind: 'create' }
  | { kind: 'reuse'; conceptId: string; version: number; note?: string }
  | { kind: 'skip' };

export interface DraftChoiceState {
  /** tempId → 勾选决定；未出现 = 按默认规则（explicit→create、inferred→不选）。 */
  concepts: Record<string, ConceptChoice>;
  /** tempId → 是否勾选该关系；未出现 = 按默认（explicit 选、inferred 不选）。 */
  relations: Record<string, boolean>;
  /** tempId → 端点重绑定（from/to）。 */
  rebinds: Record<string, { fromRef?: ConceptDraftRef; toRef?: ConceptDraftRef }>;
  /** tempId → 用户确认 inferred（acknowledged）。 */
  acknowledged: Record<string, boolean>;
}

export function defaultChoiceState(draft: ConceptDraft): DraftChoiceState {
  const state: DraftChoiceState = { concepts: {}, relations: {}, rebinds: {}, acknowledged: {} };
  for (const concept of draft.concepts) {
    state.concepts[concept.tempId] = concept.basis === 'inferred' ? { kind: 'skip' } : { kind: 'create' };
  }
  for (const relation of draft.relations) {
    state.relations[relation.tempId] = relation.basis !== 'inferred';
  }
  return state;
}

function refTempId(ref: ConceptDraft['relations'][number]['fromRef']): string | null {
  return ref.kind === 'candidate' ? ref.tempId : null;
}

/** 概念被勾选（create/reuse）？ */
export function conceptChosen(state: DraftChoiceState, tempId: string): boolean {
  const choice = state.concepts[tempId];
  return choice !== undefined && choice.kind !== 'skip';
}

/** 关系有效勾选：本身勾选且两个端点（解析重绑定后）都被保留。 */
export function relationChosen(
  draft: ConceptDraft,
  state: DraftChoiceState,
  tempId: string,
): boolean {
  const relation = draft.relations.find((item) => item.tempId === tempId);
  if (!relation) return false;
  if (!(state.relations[tempId] ?? relation.basis !== 'inferred')) return false;
  const fromRef = state.rebinds[tempId]?.fromRef ?? relation.fromRef;
  const toRef = state.rebinds[tempId]?.toRef ?? relation.toRef;
  const fromTemp = fromRef.kind === 'candidate' ? fromRef.tempId : null;
  const toTemp = toRef.kind === 'candidate' ? toRef.tempId : null;
  if (fromTemp !== null && !conceptChosen(state, fromTemp)) return false;
  if (toTemp !== null && !conceptChosen(state, toTemp)) return false;
  return true;
}

/** 勾选/取消一个概念：取消时依赖它的关系默认取消（用户仍可单独改回或重绑定）。 */
export function chooseConcept(
  draft: ConceptDraft,
  state: DraftChoiceState,
  tempId: string,
  choice: ConceptChoice,
): DraftChoiceState {
  const next: DraftChoiceState = {
    concepts: { ...state.concepts, [tempId]: choice },
    relations: { ...state.relations },
    rebinds: { ...state.rebinds },
    acknowledged: { ...state.acknowledged },
  };
  if (choice.kind === 'skip') {
    for (const relation of draft.relations) {
      if (refTempId(relation.fromRef) === tempId || refTempId(relation.toRef) === tempId) {
        next.relations[relation.tempId] = false;
      }
    }
  }
  return next;
}

/** 勾选/取消一条关系。取消节点的依赖关系若要保留，必须先重绑定端点。 */
export function chooseRelation(
  state: DraftChoiceState,
  tempId: string,
  chosen: boolean,
): DraftChoiceState {
  return { ...state, relations: { ...state.relations, [tempId]: chosen } };
}

export function rebindRelation(
  state: DraftChoiceState,
  tempId: string,
  patch: { fromRef?: ConceptDraftRef; toRef?: ConceptDraftRef },
): DraftChoiceState {
  const current = state.rebinds[tempId] ?? {};
  return {
    ...state,
    rebinds: { ...state.rebinds, [tempId]: { ...current, ...patch } },
  };
}

/** 勾选 inferred 项需要显式确认（acknowledged）。 */
export function acknowledge(state: DraftChoiceState, tempId: string): DraftChoiceState {
  return { ...state, acknowledged: { ...state.acknowledged, [tempId]: true } };
}

export function isAcknowledged(
  draft: ConceptDraft,
  state: DraftChoiceState,
  tempId: string,
  scope: 'concept' | 'relation',
): boolean {
  const basis =
    scope === 'concept'
      ? draft.concepts.find((item) => item.tempId === tempId)?.basis
      : draft.relations.find((item) => item.tempId === tempId)?.basis;
  if (basis !== 'inferred') return true;
  return state.acknowledged[tempId] === true;
}

export interface CommitPlan {
  conceptDecisions: ConceptDecision[];
  relationDecisions: RelationDecision[];
  /** 选了但未确认的 inferred 项（提交前必须 acknowledged，否则服务端 422）。 */
  unconfirmedInferred: string[];
}

/** 由勾选状态生成提交命令；未提及项服务端视为 skip。 */
export function buildCommitPlan(draft: ConceptDraft, state: DraftChoiceState): CommitPlan {
  const conceptDecisions: ConceptDecision[] = [];
  const relationDecisions: RelationDecision[] = [];
  const unconfirmedInferred: string[] = [];

  for (const concept of draft.concepts) {
    const choice = state.concepts[concept.tempId] ?? { kind: 'skip' as const };
    if (choice.kind === 'create') {
      if (concept.basis === 'inferred' && !isAcknowledged(draft, state, concept.tempId, 'concept')) {
        unconfirmedInferred.push(concept.tempId);
      }
      conceptDecisions.push({
        tempId: concept.tempId,
        decision: 'create',
        ...(concept.basis === 'inferred' ? { acknowledged: true } : {}),
      });
    } else if (choice.kind === 'reuse') {
      if (concept.basis === 'inferred' && !isAcknowledged(draft, state, concept.tempId, 'concept')) {
        unconfirmedInferred.push(concept.tempId);
      }
      conceptDecisions.push({
        tempId: concept.tempId,
        decision: 'reuse',
        reuseConceptId: choice.conceptId,
        reuseExpectedVersion: choice.version,
        ...(choice.note ? { note: choice.note } : {}),
        ...(concept.basis === 'inferred' ? { acknowledged: true } : {}),
      });
    }
  }

  for (const relation of draft.relations) {
    if (!relationChosen(draft, state, relation.tempId)) continue;
    if (relation.basis === 'inferred' && !isAcknowledged(draft, state, relation.tempId, 'relation')) {
      unconfirmedInferred.push(relation.tempId);
    }
    const rebind = state.rebinds[relation.tempId];
    relationDecisions.push({
      tempId: relation.tempId,
      decision: 'create',
      ...(rebind?.fromRef ? { fromRef: rebind.fromRef } : {}),
      ...(rebind?.toRef ? { toRef: rebind.toRef } : {}),
      ...(relation.basis === 'inferred' ? { acknowledged: true } : {}),
    });
  }
  return { conceptDecisions, relationDecisions, unconfirmedInferred };
}
