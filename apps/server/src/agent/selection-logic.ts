export const SELECTION_MIN_CARDS = 1;
export const SELECTION_MAX_CARDS = 3;

export const SELECTION_SYSTEM_PROMPT = `你是 Inwit 的选段写卡 Agent。用户从一篇学习材料里划了一段原文，你只根据这段原文写出 1–3 张可复习的原子卡片。

只输出 JSON，不要解释。输出形如：
{"cards":[{"concept":"...","example":"...","confusion_point":"...","tags":["..."],"anchor_text":"..."}]}

约束：
- 1 到 3 张卡。每张卡只讲一个概念。
- concept：一条独立可复习的概念（一句话能说清）
- example：一个具体例子
- confusion_point：一个易混点；没有就给空字符串
- tags：0-5 个短标签
- anchor_text：必须是用户选中原文里的逐字子串，不允许改写、补字或删字。
- 不要编造选段里没有的知识点。`;

export interface SelectionCardDraft {
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
  anchorText: string;
}

export function selectionUserPrompt(input: { title: string; selectionText: string }): string {
  return `文档标题：${input.title}

选中原文：
${input.selectionText}

请根据选中原文写出 1–3 张卡片。`;
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function foldWs(value: string): string {
  return value.replace(/\s+/g, '');
}

/** True when `anchor` appears in the selection, allowing collapsed whitespace. */
export function isAnchorInSelection(anchor: string, selectionText: string): boolean {
  const needle = anchor.trim();
  if (needle.length === 0) return false;
  if (selectionText.includes(needle)) return true;
  const collapsedNeedle = collapseWs(needle);
  if (collapsedNeedle.length > 0 && collapseWs(selectionText).includes(collapsedNeedle)) return true;
  const folded = foldWs(needle);
  return folded.length > 0 && foldWs(selectionText).includes(folded);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeSelectionDraft(
  raw: unknown,
  selectionText: string,
): SelectionCardDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const concept = asString(record.concept)?.trim() ?? '';
  const example = asString(record.example)?.trim() ?? '';
  const confusionPoint =
    asString(record.confusionPoint)?.trim() ?? asString(record.confusion_point)?.trim() ?? '';
  const anchorText =
    asString(record.anchorText)?.trim() ?? asString(record.anchor_text)?.trim() ?? '';
  if (concept.length === 0 || example.length === 0) return null;
  if (!isAnchorInSelection(anchorText, selectionText)) return null;
  return {
    concept,
    example,
    confusionPoint,
    tags: asStringArray(record.tags).slice(0, 5),
    anchorText,
  };
}

function extractJsonValue(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.search(/[\[{]/);
  if (start < 0) return undefined;
  const sliced = raw.slice(start);
  try {
    return JSON.parse(sliced);
  } catch {
    const endObj = sliced.lastIndexOf('}');
    const endArr = sliced.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (end <= 0) return undefined;
    try {
      return JSON.parse(sliced.slice(0, end + 1));
    } catch {
      return undefined;
    }
  }
}

function asDraftList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && value !== null && 'cards' in value) {
    const cards = (value as { cards?: unknown }).cards;
    if (Array.isArray(cards)) return cards;
  }
  return [];
}

/** Parse LLM JSON into at most 3 drafts whose anchor is a substring of the selection. */
export function parseSelectionCards(rawText: string, selectionText: string): SelectionCardDraft[] {
  const parsed = extractJsonValue(rawText);
  const drafts: SelectionCardDraft[] = [];
  for (const item of asDraftList(parsed)) {
    const draft = normalizeSelectionDraft(item, selectionText);
    if (!draft) continue;
    drafts.push(draft);
    if (drafts.length >= SELECTION_MAX_CARDS) break;
  }
  return drafts;
}

export function selectionResultSummary(cardCount: number): string {
  return `cards=${String(cardCount)}`;
}
