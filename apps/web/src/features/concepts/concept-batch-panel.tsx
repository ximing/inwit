import { observer, useService } from '@rabjs/react';
import { Loader2, X } from 'lucide-react';
import { ConceptsService } from './concepts.service.js';
import { conceptChosen, relationChosen } from './concept-selection-logic.js';

/**
 * 候选批次面板：生成进度、候选编辑与确认收录。
 * 显示在概念区内，不抢焦点；完成只提示。
 */
export const ConceptBatchPanel = observer(function ConceptBatchPanel({ onClose }: { onClose(): void }) {
  const service = useService(ConceptsService);
  const batch = service.batch;
  const draft = service.draft;
  const state = service.choiceState;

  return (
    <section className="concept-batch" aria-label="概念候选">
      <div className="concept-batch-head">
        <h3>概念与关系候选</h3>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>

      {service.batchPhase === 'generating' ? (
        <p className="concept-batch-status" role="status">
          <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
          正在生成候选…可以先看别的文章，回到本文后会看到结果。
        </p>
      ) : null}

      {service.batchPhase === 'error' ? (
        <div className="concept-batch-status is-error" role="alert">
          <p>{service.batchError ?? '生成失败'}</p>
          {service.writable ? (
            <button type="button" onClick={() => void service.startGeneration('document')}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {batch?.stale ? (
        <p className="concept-batch-status is-error" role="alert">正文已变化，这批候选不能收录，请重新生成。</p>
      ) : null}

      {service.batchPhase === 'ready' && draft && state ? (
        <>
          {draft.concepts.length === 0 && draft.relations.length === 0 ? (
            <p className="concept-batch-status">{batch?.resultNote ?? '没有识别到可提取的概念'}</p>
          ) : null}
          {batch?.resultNote ? <p className="concept-batch-note">{batch.resultNote}</p> : null}

          <ul className="concept-batch-list">
            {draft.concepts.map((concept) => {
              const chosen = conceptChosen(state, concept.tempId);
              return (
                <li key={concept.tempId} className={chosen ? '' : 'is-off'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen}
                      disabled={!service.writable}
                      onChange={(event) =>
                        service.chooseDraftConcept(
                          concept.tempId,
                          event.target.checked
                            ? concept.matchCandidates[0]
                              ? {
                                  kind: 'reuse',
                                  conceptId: concept.matchCandidates[0].conceptId,
                                  version: 1,
                                }
                              : { kind: 'create' }
                            : { kind: 'skip' },
                        )
                      }
                    />
                    <span className="concept-batch-name">{concept.name}</span>
                    {concept.sense ? <span className="concept-batch-sense">{concept.sense}</span> : null}
                    {concept.basis === 'inferred' ? <span className="concept-batch-inferred">推断</span> : null}
                  </label>
                  {concept.definition ? <p className="concept-batch-def">{concept.definition}</p> : null}
                  {concept.matchCandidates.length > 0 ? (
                    <p className="concept-batch-match">
                      可能已有：
                      {concept.matchCandidates.map((match) => (
                        <button
                          key={match.conceptId}
                          type="button"
                          disabled={!service.writable}
                          onClick={() =>
                            service.chooseDraftConcept(concept.tempId, {
                              kind: 'reuse',
                              conceptId: match.conceptId,
                              version: 1,
                            })
                          }
                        >
                          复用「{match.name}」
                        </button>
                      ))}
                    </p>
                  ) : null}
                  {service.writable && concept.basis === 'inferred' && chosen && !state.acknowledged[concept.tempId] ? (
                    <button type="button" onClick={() => service.acknowledgeDraft(concept.tempId)}>
                      确认收录这个推断
                    </button>
                  ) : null}
                </li>
              );
            })}
            {draft.relations.map((relation) => {
              const chosen = relationChosen(draft, state, relation.tempId);
              const nameOf = (tempId: string) =>
                draft.concepts.find((concept) => concept.tempId === tempId)?.name ?? tempId;
              const endpointName = (ref: (typeof relation.fromRef)) =>
                ref.kind === 'candidate' ? nameOf(ref.tempId) : '（已有概念）';
              return (
                <li key={relation.tempId} className={chosen ? '' : 'is-off'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen}
                      disabled={
                        !service.writable ||
                        (!conceptChosen(state, relation.fromRef.kind === 'candidate' ? relation.fromRef.tempId : '') &&
                          relation.fromRef.kind === 'candidate' &&
                          !state.rebinds[relation.tempId]?.fromRef)
                      }
                      onChange={(event) => service.chooseDraftRelation(relation.tempId, event.target.checked)}
                    />
                    <span>
                      {endpointName(relation.fromRef)} → {relation.predicate} → {endpointName(relation.toRef)}
                    </span>
                    {relation.basis === 'inferred' ? <span className="concept-batch-inferred">推断</span> : null}
                  </label>
                  {service.writable && relation.basis === 'inferred' && chosen && !state.acknowledged[relation.tempId] ? (
                    <button type="button" onClick={() => service.acknowledgeDraft(relation.tempId)}>
                      确认这条推断关系
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {service.batchError ? <p className="concepts-error" role="alert">{service.batchError}</p> : null}

          {service.writable ? (
            <div className="concept-detail-ops">
              <button
                type="button"
                disabled={service.batchPhase !== 'ready' || batch?.stale === true}
                onClick={() => void service.commitBatch()}
              >
                {(service.batchPhase as string) === 'committing' ? '收录中…' : '收录所选'}
              </button>
              <button type="button" onClick={() => void service.discardBatch()}>
                丢弃本批
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {service.batchPhase === 'done' ? (
        <p className="concept-batch-status" role="status">{service.commitSummary ?? '已收录'}</p>
      ) : null}
    </section>
  );
});
