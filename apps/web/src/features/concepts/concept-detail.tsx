import { observer, useService } from '@rabjs/react';
import { Archive, Loader2, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import type { ConceptDetail, ConceptRelationDetail, EvidenceResolution } from '@inwit/dto';
import * as api from '@/api/concepts';
import { DialogService } from '@/services/dialog.service.js';
import { ConceptsService } from './concepts.service.js';
import { ConceptPracticeDialog } from './concept-practice-dialog.js';

function EvidenceList({ evidence }: { evidence: ConceptDetail['evidence'] }) {
  const service = useService(ConceptsService);
  const [resolving, setResolving] = useState<string | null>(null);
  if (evidence.length === 0) return <p className="concept-detail-empty">暂无出处。</p>;
  return (
    <ul className="concept-evidence">
      {evidence.map((item) => (
        <li key={item.id}>
          <blockquote>{item.quote}</blockquote>
          <div className="concept-evidence-meta">
            <span>{item.documentTitleSnapshot || '未命名文档'}</span>
            {item.availability === 'unavailable' ? <span className="is-stale">来源不可用</span> : null}
            <button
              type="button"
              disabled={resolving === item.id}
              onClick={async () => {
                setResolving(item.id);
                try {
                  const resolution: EvidenceResolution = await api.resolveConceptEvidence(item.id);
                  if (resolution.status === 'resolved') {
                    service.error = null;
                    // 由工作区负责正文跳转（原文块号）
                    window.dispatchEvent(
                      new CustomEvent('inwit:concept-locate-block', {
                        detail: { documentId: item.documentId, blockIndex: resolution.blockIndex },
                      }),
                    );
                  } else {
                    service.error = '原文已变化，无法定位，仅保留摘录';
                  }
                } finally {
                  setResolving(null);
                }
              }}
            >
              {resolving === item.id ? '定位中…' : '定位原文'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export const ConceptDetailPane = observer(function ConceptDetailPane({
  detail,
  onClose,
}: {
  detail: ConceptDetail;
  onClose(): void;
}) {
  const service = useService(ConceptsService);
  const dialog = useService(DialogService);
  const [editing, setEditing] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [form, setForm] = useState({ name: detail.concept.name, sense: detail.concept.sense ?? '', definition: detail.concept.definition ?? '', example: detail.concept.example ?? '' });
  const concept = detail.concept;
  const practice = detail.practice;

  return (
    <aside className="concept-detail" aria-label="概念详情">
      <div className="concept-detail-head">
        <h3>{concept.name}</h3>
        <button type="button" className="concept-detail-close" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>
      {concept.sense ? <p className="concept-detail-sense">{concept.sense}</p> : null}
      {concept.archivedAt ? <p className="concept-detail-archived">已归档</p> : null}

      {editing ? (
        <form
          className="concept-detail-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await service.updateConcept(concept.id, {
              expectedVersion: concept.version,
              name: form.name.trim() || concept.name,
              sense: form.sense.trim() || null,
              definition: form.definition.trim() || null,
              example: form.example.trim() || null,
            });
            setEditing(false);
          }}
        >
          <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>语境<input value={form.sense} onChange={(e) => setForm({ ...form, sense: e.target.value })} placeholder="同名异义时区分" /></label>
          <label>共享定义<textarea value={form.definition} rows={3} onChange={(e) => setForm({ ...form, definition: e.target.value })} /></label>
          <p className="concept-detail-hint">修改共享定义会影响其他文章与相关练习。</p>
          <label>例子<textarea value={form.example} rows={2} onChange={(e) => setForm({ ...form, example: e.target.value })} /></label>
          <div className="concept-detail-ops">
            <button type="submit" disabled={!service.writable}>保存</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      ) : (
        <>
          {concept.definition ? <p className="concept-detail-def">{concept.definition}</p> : <p className="concept-detail-empty">定义待补充</p>}
          {concept.example ? <p className="concept-detail-example">例：{concept.example}</p> : null}
          {concept.aliases.length > 0 ? <p className="concept-detail-aliases">别名：{concept.aliases.join('、')}</p> : null}
        </>
      )}

      {detail.practice !== undefined && practice ? (
        <section className="concept-detail-section">
          <h4>练习</h4>
          {practice.binding ? (
            <p className="concept-detail-practice">
              {practice.binding.needsRefresh ? '内容有更新，需要重新确认题目。' : null}
              {practice.binding.resumeRequired ? '知识曾归档，恢复后需要手动恢复练习。' : null}
              {practice.feedbackCount === 0 && !practice.binding.needsRefresh && !practice.binding.resumeRequired
                ? '未练习'
                : null}
              {practice.feedbackCount > 0 ? `本阶段已练习 ${practice.feedbackCount} 次` : ''}
            </p>
          ) : (
            <p className="concept-detail-practice">未加入复习</p>
          )}
          {service.writable ? (
            <button type="button" className="concepts-action" onClick={() => setPracticeOpen(true)}>
              {practice.binding ? '查看练习' : '加入复习'}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="concept-detail-section">
        <h4>相邻关系（{detail.relations.length}）</h4>
        <ul className="concept-detail-relations">
          {detail.relations.map((relation) => (
            <li key={relation.id}>
              <button type="button" onClick={() => void service.select({ kind: 'relation', id: relation.id })}>
                {relation.predicate}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="concept-detail-section">
        <h4>出处（{detail.evidence.length}）</h4>
        <EvidenceList evidence={detail.evidence} />
      </section>

      {service.writable ? (
        <div className="concept-detail-ops">
          {!editing && !concept.archivedAt ? (
            <button type="button" onClick={() => setEditing(true)}>编辑</button>
          ) : null}
          {!concept.archivedAt ? (
            <button
              type="button"
              className="is-danger"
              onClick={async () => {
                const ok = await dialog.confirm('归档概念会同时隐藏其关系并暂停相关练习。', {
                  title: '归档概念',
                  ok: '归档',
                  cancel: '返回',
                });
                if (!ok) return;
                await service.archiveConcept(concept.id, concept.version);
              }}
            >
              <Archive width={13} height={13} strokeWidth={1.8} /> 归档
            </button>
          ) : (
            <button type="button" onClick={() => void service.restoreConcept(concept.id, concept.version)}>
              <RotateCcw width={13} height={13} strokeWidth={1.8} /> 恢复
            </button>
          )}
        </div>
      ) : null}

      {practiceOpen ? (
        <ConceptPracticeDialog targetKind="concept" targetId={concept.id} onClose={() => setPracticeOpen(false)} />
      ) : null}
    </aside>
  );
});

export const RelationDetailPane = observer(function RelationDetailPane({
  detail,
  onClose,
}: {
  detail: ConceptRelationDetail;
  onClose(): void;
}) {
  const service = useService(ConceptsService);
  const dialog = useService(DialogService);
  const [editing, setEditing] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [form, setForm] = useState({
    predicate: detail.relation.predicate,
    context: detail.relation.context ?? '',
    explanation: detail.relation.explanation ?? '',
    example: detail.relation.example ?? '',
  });
  const relation = detail.relation;

  return (
    <aside className="concept-detail" aria-label="关系详情">
      <div className="concept-detail-head">
        <h3>
          {detail.fromConcept.name} <span className="concept-rel-arrow">→</span> {relation.predicate} <span className="concept-rel-arrow">→</span> {detail.toConcept.name}
        </h3>
        <button type="button" className="concept-detail-close" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>
      {relation.basis === 'inferred' ? <p className="concept-detail-sense">推断（经确认收录）</p> : null}
      {relation.context ? <p className="concept-detail-sense">语境：{relation.context}</p> : null}

      {editing ? (
        <form
          className="concept-detail-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await service.updateRelation(relation.id, {
              expectedVersion: relation.version,
              predicate: form.predicate.trim() || relation.predicate,
              context: form.context.trim() || null,
              explanation: form.explanation.trim() || null,
              example: form.example.trim() || null,
            });
            setEditing(false);
          }}
        >
          <label>谓词<input value={form.predicate} onChange={(e) => setForm({ ...form, predicate: e.target.value })} /></label>
          <label>语境<input value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} /></label>
          <label>解释<textarea rows={3} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} /></label>
          <label>例子<textarea rows={2} value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} /></label>
          <div className="concept-detail-ops">
            <button type="submit" disabled={!service.writable}>保存</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      ) : (
        <>
          {relation.explanation ? <p className="concept-detail-def">{relation.explanation}</p> : null}
          {relation.example ? <p className="concept-detail-example">例：{relation.example}</p> : null}
        </>
      )}

      {detail.practice ? (
        <section className="concept-detail-section">
          <h4>练习</h4>
          <p className="concept-detail-practice">
            {detail.practice.binding
              ? detail.practice.feedbackCount > 0
                ? `本阶段已练习 ${detail.practice.feedbackCount} 次`
                : '未练习'
              : '未加入复习'}
          </p>
          {service.writable ? (
            <button type="button" className="concepts-action" onClick={() => setPracticeOpen(true)}>
              {detail.practice.binding ? '查看练习' : '加入复习'}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="concept-detail-section">
        <h4>出处（{detail.evidence.length}）</h4>
        <EvidenceList evidence={detail.evidence} />
      </section>

      {service.writable ? (
        <div className="concept-detail-ops">
          {!editing && !relation.archivedAt ? <button type="button" onClick={() => setEditing(true)}>编辑</button> : null}
          {!relation.archivedAt ? (
            <button
              type="button"
              className="is-danger"
              onClick={async () => {
                const ok = await dialog.confirm('归档关系会暂停相关练习，恢复需手动进行。', {
                  title: '归档关系',
                  ok: '归档',
                  cancel: '返回',
                });
                if (!ok) return;
                await service.archiveRelation(relation.id, relation.version);
              }}
            >
              <Archive width={13} height={13} strokeWidth={1.8} /> 归档
            </button>
          ) : null}
        </div>
      ) : null}

      {practiceOpen ? (
        <ConceptPracticeDialog targetKind="relation" targetId={relation.id} onClose={() => setPracticeOpen(false)} />
      ) : null}
      {service.detailLoading ? <Loader2 className="icon-spin" width={14} height={14} /> : null}
    </aside>
  );
});
