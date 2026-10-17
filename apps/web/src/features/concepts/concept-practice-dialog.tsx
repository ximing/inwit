import { observer, useService } from '@rabjs/react';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import * as api from '@/api/concepts';
import { ApiError } from '@/api/client';
import { DialogService } from '@/services/dialog.service.js';
import { DocsService } from '@/pages/docs/docs.service.js';
import { ConceptsService } from './concepts.service.js';

type ExerciseKind = 'recall' | 'compare' | 'scenario';

const KIND_LABELS: Record<ExerciseKind, string> = {
  recall: '概念回忆',
  compare: '关系辨析',
  scenario: '场景判断',
};

/**
 * 练习对话框（T9）：查看已有练习 / 手写 / 智能出题 / 绑定已有卡片。
 * 仅打开不入队；显式确认才加入复习。
 */
export const ConceptPracticeDialog = observer(function ConceptPracticeDialog({
  targetKind,
  targetId,
  onClose,
}: {
  targetKind: 'concept' | 'relation';
  targetId: string;
  onClose(): void;
}) {
  const service = useService(ConceptsService);
  const dialog = useService(DialogService);
  const docs = useService(DocsService);
  const [exerciseKind, setExerciseKind] = useState<ExerciseKind>('recall');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [proposalState, setProposalState] = useState<'idle' | 'waiting' | 'failed'>('idle');
  const [bindCardId, setBindCardId] = useState('');

  const detail = service.detail;
  const practice = detail?.practice;
  const binding = practice?.binding ?? null;
  const targetVersion =
    detail && 'concept' in detail ? detail.concept.version : detail?.relation.version ?? 1;

  const refreshDetail = async () => {
    await service.select({ kind: targetKind, id: targetId });
  };

  const bindableCards = (docs.doc?.cards ?? []).filter(
    (card) => card.acceptance === 'accepted' && card.questions.length > 0,
  );

  return (
    <div className="concept-practice" role="dialog" aria-label="练习">
      <div className="concept-practice-head">
        <h3>练习</h3>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X width={14} height={14} strokeWidth={1.8} />
        </button>
      </div>

      {binding ? (
        <section className="concept-practice-existing">
          <p>
            已有练习（{KIND_LABELS[binding.exerciseKind]}）：
            {binding.needsRefresh ? '内容有更新，需要重新确认题目。' : null}
            {binding.resumeRequired ? '知识曾归档，需要手动恢复练习。' : null}
            {!binding.needsRefresh && !binding.resumeRequired
              ? practice?.feedbackCount
                ? `本阶段已练习 ${practice.feedbackCount} 次`
                : '未练习'
              : null}
          </p>
          {binding.needsRefresh && service.writable ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!service.allowWrite()) return;
                setBusy('refresh');
                try {
                  const card = docs.doc?.cards.find((item) => item.id === binding.cardId);
                  await service.refreshPractice(binding.id, {
                    questionId: binding.questionId,
                    expectedTargetVersion: targetVersion,
                    expectedReviewRevision: card?.reviewRevision ?? 1,
                    question: question.trim(),
                    answer: answer.trim(),
                  });
                  await refreshDetail();
                  setQuestion('');
                  setAnswer('');
                } catch (err) {
                  await dialog.alert(err instanceof ApiError ? err.message : '更新失败', { title: '练习' });
                } finally {
                  setBusy(null);
                }
              }}
            >
              <label>新题面<textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
              <label>新答案<textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
              <button type="submit" disabled={busy !== null || !question.trim() || !answer.trim()}>
                {busy === 'refresh' ? '更新中…' : '更新练习'}
              </button>
            </form>
          ) : null}
          {binding.resumeRequired && service.writable ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (!service.allowWrite()) return;
                setBusy('resume');
                try {
                  const card = docs.doc?.cards.find((item) => item.id === binding.cardId);
                  await service.resumePractice(binding.id, {
                    expectedReviewRevision: card?.reviewRevision ?? 1,
                  });
                  await refreshDetail();
                } catch (err) {
                  await dialog.alert(err instanceof ApiError ? err.message : '恢复失败', { title: '练习' });
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'resume' ? '恢复中…' : '恢复练习（保留原进度）'}
            </button>
          ) : null}
          {service.writable ? (
            <button
              type="button"
              className="is-danger"
              disabled={busy !== null}
              onClick={async () => {
                if (!service.allowWrite()) return;
                const ok = await dialog.confirm('解除后卡片保留，普通复习可能按原排期重新出现。', {
                  title: '解除练习绑定',
                  ok: '解除',
                  cancel: '返回',
                });
                if (!ok) return;
                setBusy('unbind');
                try {
                  await service.unbindPractice(binding.id);
                  await refreshDetail();
                } catch (err) {
                  await dialog.alert(err instanceof Error ? err.message : '解除失败', { title: '练习' });
                } finally {
                  setBusy(null);
                }
              }}
            >
              解除练习绑定
            </button>
          ) : null}
        </section>
      ) : service.writable ? (
        <section className="concept-practice-new">
          <label>
            练习类型
            <select value={exerciseKind} onChange={(e) => setExerciseKind(e.target.value as ExerciseKind)}>
              <option value="recall">概念回忆</option>
              <option value="compare">关系辨析</option>
              <option value="scenario">场景判断</option>
            </select>
          </label>
          <div className="concept-practice-ai">
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (!service.allowWrite()) return;
                setBusy('propose');
                setProposalState('waiting');
                try {
                  const proposalId = await service.proposePractice({
                    targetKind,
                    targetId,
                    exerciseKind,
                    requestId: crypto.randomUUID(),
                  });
                  for (let i = 0; i < 40; i += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    const proposal = await api.getConceptPracticeProposal(proposalId);
                    if (proposal.status === 'ready' && proposal.question && proposal.answer) {
                      setQuestion(proposal.question);
                      setAnswer(proposal.answer);
                      setProposalState('idle');
                      return;
                    }
                    if (proposal.status === 'failed' || proposal.status === 'cancelled') break;
                  }
                  setProposalState('failed');
                } catch {
                  setProposalState('failed');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'propose' ? <Loader2 className="icon-spin" width={12} height={12} /> : null}
              智能出题
            </button>
            {proposalState === 'waiting' ? <span className="concept-detail-hint">正在出题…</span> : null}
            {proposalState === 'failed' ? <span className="concept-detail-hint">出题失败，可以手写</span> : null}
          </div>

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!service.allowWrite()) return;
              setBusy('create');
              try {
                await service.createPractice({
                  targetKind,
                  targetId,
                  expectedVersion: targetVersion,
                  exerciseKind,
                  question: question.trim(),
                  answer: answer.trim(),
                  requestId: crypto.randomUUID(),
                });
                await refreshDetail();
                setQuestion('');
                setAnswer('');
              } catch (err) {
                await dialog.alert(err instanceof ApiError ? err.message : '加入失败', { title: '练习' });
              } finally {
                setBusy(null);
              }
            }}
          >
            <label>题面<textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
            <label>答案<textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
            <button type="submit" disabled={busy !== null || !question.trim() || !answer.trim()}>
              {busy === 'create' ? '加入中…' : '加入复习'}
            </button>
          </form>

          {bindableCards.length > 0 ? (
            <form
              className="concept-practice-bind"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!service.allowWrite()) return;
                const card = bindableCards.find((item) => item.id === bindCardId);
                if (!card) return;
                const first = card.questions[0];
                if (!first) return;
                setBusy('bind');
                try {
                  await service.bindExistingPractice({
                    cardId: card.id,
                    questionId: first.id,
                    expectedReviewRevision: card.reviewRevision ?? null,
                    targetKind,
                    targetId,
                    expectedVersion: targetVersion,
                    exerciseKind,
                    requestId: crypto.randomUUID(),
                  });
                  await refreshDetail();
                } catch (err) {
                  await dialog.alert(err instanceof ApiError ? err.message : '绑定失败', { title: '绑定已有卡片' });
                } finally {
                  setBusy(null);
                }
              }}
            >
              <label>
                绑定已有卡片（绑定实际展示的第一题）
                <select value={bindCardId} onChange={(e) => setBindCardId(e.target.value)}>
                  <option value="">选择卡片…</option>
                  {bindableCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.concept.slice(0, 30) || '（无标题）'}（首题：{card.questions[0]?.type ?? '无'}）
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy !== null || !bindCardId}>
                {busy === 'bind' ? '绑定中…' : '绑定这张卡'}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
});
