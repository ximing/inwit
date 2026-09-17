import {
  CARD_QUESTION_TYPES,
  type CardQuestionInput,
  type CardQuestionType,
  type DocumentCard,
  type UpdateCardInput,
} from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocsService } from './docs.service';

const QUESTION_TYPE_LABELS: Record<CardQuestionType, string> = {
  cloze: '填空',
  compare: '对比',
  judge: '判断',
};

type QuestionDraft = CardQuestionInput & { key: string };

function draftsFromCard(card: DocumentCard): QuestionDraft[] {
  return card.questions.map((question, index) => ({
    key: question.id ?? `new-${index}`,
    id: question.id,
    type: question.type,
    question: question.question,
    answer: question.answer,
  }));
}

let questionKeySeq = 0;
function nextQuestionKey(): string {
  questionKeySeq += 1;
  return `q-${questionKeySeq}`;
}

export const CardEditDialog = observer(function CardEditDialog({
  card,
}: {
  card: DocumentCard;
}) {
  const service = useService(DocsService);
  const [concept, setConcept] = useState(card.concept);
  const [example, setExample] = useState(card.example);
  const [confusionPoint, setConfusionPoint] = useState(card.confusionPoint);
  const [tagsText, setTagsText] = useState(card.tags.join('，'));
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => draftsFromCard(card));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConcept(card.concept);
    setExample(card.example);
    setConfusionPoint(card.confusionPoint);
    setTagsText(card.tags.join('，'));
    setQuestions(draftsFromCard(card));
  }, [card]);

  const patchQuestion = (key: string, patch: Partial<QuestionDraft>) => {
    setQuestions((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    if (!concept.trim()) return;
    const input: UpdateCardInput = {
      concept: concept.trim(),
      example,
      confusionPoint,
      tags: tagsText
        .split(/[,，、]/)
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
      questions: questions
        .filter((row) => row.question.trim() !== '' && row.answer.trim() !== '')
        .map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          type: row.type,
          question: row.question.trim(),
          answer: row.answer.trim(),
        })),
    };
    setSaving(true);
    const ok = await service.saveCardEdit(card.id, input);
    setSaving(false);
    if (ok) service.closeCardEdit();
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={() => service.closeCardEdit()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') service.closeCardEdit();
      }}
    >
      <div
        className="dialog card-edit-dialog"
        role="dialog"
        aria-labelledby="card-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="card-edit-title">编辑卡片</h2>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            概念
            <textarea
              rows={2}
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
              maxLength={2000}
              required
            />
          </label>
          <label>
            例子
            <textarea
              rows={3}
              value={example}
              onChange={(event) => setExample(event.target.value)}
              maxLength={4000}
            />
          </label>
          <label>
            易混点
            <textarea
              rows={2}
              value={confusionPoint}
              onChange={(event) => setConfusionPoint(event.target.value)}
              maxLength={4000}
              placeholder="容易和什么搞混（可留空）"
            />
          </label>
          <label>
            标签
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="用逗号分隔，可留空"
            />
          </label>

          <div className="card-edit-questions">
            <div className="card-edit-questions-head">
              <span>问答对</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setQuestions((rows) => [
                    ...rows,
                    { key: nextQuestionKey(), type: 'cloze', question: '', answer: '' },
                  ])
                }
              >
                <Plus width={13} height={13} strokeWidth={1.8} />
                添加问题
              </button>
            </div>
            {questions.length === 0 ? (
              <p className="hint">还没有问答对，复习时会直接用概念出题。</p>
            ) : (
              questions.map((row) => (
                <div key={row.key} className="card-edit-question">
                  <div className="card-edit-question-head">
                    <select
                      value={row.type}
                      onChange={(event) =>
                        patchQuestion(row.key, {
                          type: event.target.value as CardQuestionType,
                        })
                      }
                    >
                      {CARD_QUESTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {QUESTION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="note-op"
                      aria-label="删除这个问题"
                      title="删除这个问题"
                      onClick={() =>
                        setQuestions((rows) => rows.filter((item) => item.key !== row.key))
                      }
                    >
                      <Trash2 width={13} height={13} strokeWidth={1.8} />
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={row.question}
                    placeholder="问题"
                    maxLength={2000}
                    onChange={(event) => patchQuestion(row.key, { question: event.target.value })}
                  />
                  <textarea
                    rows={2}
                    value={row.answer}
                    placeholder="答案"
                    maxLength={4000}
                    onChange={(event) => patchQuestion(row.key, { answer: event.target.value })}
                  />
                </div>
              ))
            )}
          </div>

          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => service.closeCardEdit()}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !concept.trim()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
