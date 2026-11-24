export type ReadoutCard = {
  concept: string;
  example: string;
  confusionPoint?: string;
  questions: readonly { question: string; answer: string }[];
};

/**
 * 脑图卡片只露出第一问；没展开时答案也不露。
 * 还有答案、其余题目、例子、易混点，或概念和题面不是同一句时，需要全文。
 * 题面被行数截断由 DOM 另判，不在这里。
 */
export function cardHidesBody(card: ReadoutCard, expanded: boolean): boolean {
  const first = card.questions[0];
  const question = (first?.question ?? card.concept).trim();
  const answer = (first?.answer ?? card.example).trim();
  if (!expanded && answer.length > 0) return true;
  if (card.questions.length > 1) return true;
  const example = card.example.trim();
  if (example.length > 0 && example !== answer) return true;
  if ((card.confusionPoint ?? '').trim().length > 0) return true;
  const concept = card.concept.trim();
  return concept.length > 0 && concept !== question;
}

/** 行数截断：内容比可见区域高出 1px 以上才算，避免亚像素误判。 */
export function elementIsClamped(node: { scrollHeight: number; clientHeight: number }): boolean {
  return node.scrollHeight > node.clientHeight + 1;
}

/** 全文浮层的估算尺寸。高度不超过舞台的 70%，也不超过 480，并且要放进舞台。 */
export function readoutPanelSize(stage: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.min(360, Math.max(0, stage.width - 16)),
    height: Math.min(480, Math.round(stage.height * 0.7), Math.max(0, stage.height - 16)),
  };
}
