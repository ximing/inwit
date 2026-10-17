import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { useState } from 'react';
import { DialogService } from '@/services/dialog.service.js';
import { ConceptsService } from './concepts.service.js';

/** 新建概念（可附匹配建议提示；同名异义显式选择）。 */
export const ConceptEditorDialog = observer(function ConceptEditorDialog({
  onClose,
  initialName = '',
}: {
  onClose(): void;
  initialName?: string;
}) {
  const service = useService(ConceptsService);
  const [name, setName] = useState(initialName);
  const [sense, setSense] = useState('');
  const [definition, setDefinition] = useState('');
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = service.matches;

  return (
    <div className="concept-editor" role="dialog" aria-label="新建概念">
      <div className="concept-editor-head">
        <h3>新建概念</h3>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await service.createConcept({
              name: name.trim(),
              aliases: aliases.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
              ...(sense.trim() ? { sense: sense.trim() } : {}),
              ...(definition.trim() ? { definition: definition.trim() } : {}),
              evidence: [],
            });
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          名称
          <input
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              void service.searchMatches(event.target.value);
            }}
          />
        </label>
        {matches.length > 0 ? (
          <div className="concept-editor-matches" role="status">
            <p>同主题已有相似概念（不会被合并）：</p>
            {matches.map((match) => (
              <button
                key={match.conceptId}
                type="button"
                onClick={() => void service.select({ kind: 'concept', id: match.conceptId })}
              >
                {match.name}
                {match.sense ? `（${match.sense}）` : ''} · {match.matchedBy === 'name' ? '同名' : '别名'}
              </button>
            ))}
          </div>
        ) : null}
        <label>
          语境（同名异义时区分）
          <input value={sense} onChange={(event) => setSense(event.target.value)} />
        </label>
        <label>
          别名（用「、」分隔）
          <input value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </label>
        <label>
          定义
          <textarea rows={3} value={definition} onChange={(event) => setDefinition(event.target.value)} />
        </label>
        <div className="concept-detail-ops">
          <button type="submit" disabled={busy || !name.trim() || !service.writable}>
            保存概念
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
});

/** 连接概念（源 → 谓词 → 目标）。 */
export const RelationEditorDialog = observer(function RelationEditorDialog({
  onClose,
}: {
  onClose(): void;
}) {
  const service = useService(ConceptsService);
  const dialog = useService(DialogService);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [predicate, setPredicate] = useState('');
  const [kind, setKind] = useState<'composition' | 'execution' | 'evaluation' | 'dependency' | 'contrast' | 'other'>('other');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const options = service.visibleConcepts;

  return (
    <div className="concept-editor" role="dialog" aria-label="连接概念">
      <div className="concept-editor-head">
        <h3>连接概念</h3>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!fromId || !toId || !predicate.trim()) return;
          setBusy(true);
          try {
            const fromConcept = options.find((concept) => concept.id === fromId);
            await service.saveBundle({
              concept: { kind: 'reuse', conceptId: fromId, expectedVersion: fromConcept?.version ?? 1, evidence: [] },
              relations: [
                {
                  direction: 'outgoing',
                  other: { kind: 'existing', conceptId: toId },
                  kind,
                  predicate: predicate.trim(),
                  basis: 'user',
                  ...(context.trim() ? { context: context.trim() } : {}),
                  evidence: [],
                },
              ],
            });
            onClose();
          } catch (err) {
            await dialog.alert(err instanceof Error ? err.message : '保存失败', { title: '连接概念' });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          源概念
          <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
            <option value="">选择…</option>
            {options.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.name}
                {concept.sense ? `（${concept.sense}）` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          谓词
          <input value={predicate} onChange={(event) => setPredicate(event.target.value)} placeholder="如：可以进行多次" />
        </label>
        <label>
          目标概念
          <select value={toId} onChange={(event) => setToId(event.target.value)}>
            <option value="">选择…</option>
            {options.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.name}
                {concept.sense ? `（${concept.sense}）` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="composition">组成</option>
            <option value="execution">执行流程</option>
            <option value="evaluation">评判</option>
            <option value="dependency">依赖</option>
            <option value="contrast">对比</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          语境（可选）
          <input value={context} onChange={(event) => setContext(event.target.value)} />
        </label>
        <p className="concept-detail-hint">
          {fromId && toId && predicate.trim()
            ? `预览：${options.find((c) => c.id === fromId)?.name ?? '?'} → ${predicate.trim()} → ${options.find((c) => c.id === toId)?.name ?? '?'}`
            : '方向与谓词表达同一含义。'}
        </p>
        <div className="concept-detail-ops">
          <button type="submit" disabled={busy || !fromId || !toId || !predicate.trim() || !service.writable}>
            保存关系
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
});

const LINK_KINDS = [
  ['other', '其他'],
  ['composition', '组成'],
  ['execution', '执行流程'],
  ['evaluation', '评判'],
  ['dependency', '依赖'],
  ['contrast', '对比'],
] as const;

/** 图上拖线之后，只补谓词。两端已经由连线决定。 */
export const ConceptLinkDraft = observer(function ConceptLinkDraft({
  fromId,
  toId,
  onClose,
}: {
  fromId: string;
  toId: string;
  onClose(): void;
}) {
  const service = useService(ConceptsService);
  const dialog = useService(DialogService);
  const [predicate, setPredicate] = useState('');
  const [kind, setKind] = useState<(typeof LINK_KINDS)[number][0]>('other');
  const [busy, setBusy] = useState(false);
  const from = service.visibleConcepts.find((concept) => concept.id === fromId);
  const to = service.visibleConcepts.find((concept) => concept.id === toId);

  return (
    <form
      className="concept-link-draft"
      onSubmit={async (event) => {
        event.preventDefault();
        const text = predicate.trim();
        if (!text || !from || busy) return;
        setBusy(true);
        try {
          const result = await service.saveBundle({
            concept: { kind: 'reuse', conceptId: fromId, expectedVersion: from.version, evidence: [] },
            relations: [
              {
                direction: 'outgoing',
                other: { kind: 'existing', conceptId: toId },
                kind,
                predicate: text,
                basis: 'user',
                evidence: [],
              },
            ],
          });
          const created = result.relations.find((row) => row.relation.predicate === text) ?? result.relations.at(-1);
          onClose();
          if (created) void service.select({ kind: 'relation', id: created.relation.id });
        } catch (err) {
          await dialog.alert(err instanceof Error ? err.message : '保存失败', { title: '建立关系' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="concept-link-draft-ends">
        {from?.name ?? '概念'} <span aria-hidden>→</span> {to?.name ?? '概念'}
      </p>
      <input
        autoFocus
        value={predicate}
        placeholder="这条关系是什么"
        aria-label="谓词"
        onChange={(event) => setPredicate(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <select aria-label="关系类型" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
        {LINK_KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy || !predicate.trim()}>
        建立
      </button>
      <button type="button" onClick={onClose}>
        取消
      </button>
    </form>
  );
});
