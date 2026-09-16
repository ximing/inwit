export const SELECTION_MIN_CARDS = 1;
export const SELECTION_MAX_CARDS = 3;

export const SELECTION_SYSTEM_PROMPT = `你是 Inwit 的选段写卡 Agent。用户从一篇学习材料里划了一段原文，你只根据这段原文写出 1–3 张可复习的原子卡片。

只输出 JSON，不要解释。输出形如：
{"cards":[{"concept":"...","example":"...","confusion_point":"...","tags":["..."]}]}

约束：
- 1 到 3 张卡。每张卡只讲一个概念。
- concept：一条独立可复习的概念（一句话能说清）
- example：一个具体例子
- confusion_point：一个易混点；没有就给空字符串
- tags：0-5 个短标签
- 不要编造选段里没有的知识点。
- 不必给出原文位置；锚点由系统按用户划词写入。`;

export interface SelectionCardDraft {
  concept: string;
  example: string;
  confusionPoint: string;
  tags: string[];
}

export function selectionUserPrompt(input: { title: string; selectionText: string }): string {
  return `文档标题：${input.title}

选中原文：
${input.selectionText}

请根据选中原文写出 1–3 张卡片。`;
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

export function normalizeSelectionDraft(raw: unknown): SelectionCardDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const concept = asString(record.concept)?.trim() ?? '';
  const example = asString(record.example)?.trim() ?? '';
  const confusionPoint =
    asString(record.confusionPoint)?.trim() ?? asString(record.confusion_point)?.trim() ?? '';
  if (concept.length === 0 || example.length === 0) return null;
  return {
    concept,
    example,
    confusionPoint,
    tags: asStringArray(record.tags).slice(0, 5),
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

/** Parse LLM JSON into at most 3 drafts. Anchors are inherited from the user selection. */
export function parseSelectionCards(rawText: string): SelectionCardDraft[] {
  const parsed = extractJsonValue(rawText);
  const drafts: SelectionCardDraft[] = [];
  for (const item of asDraftList(parsed)) {
    const draft = normalizeSelectionDraft(item);
    if (!draft) continue;
    drafts.push(draft);
    if (drafts.length >= SELECTION_MAX_CARDS) break;
  }
  return drafts;
}

export function selectionResultSummary(cardCount: number): string {
  return `cards=${String(cardCount)}`;
}
