import { UNNAMED_DOCUMENT_TITLE } from '@inwit/dto';

export const DOCUMENT_AGENT_TITLE_MAX = 20;
export const DOCUMENT_DESCRIPTION_MAX = 60;
export const DOCUMENT_META_MIN_CONTENT_CHARS = 8;

export function clipChars(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, Math.max(0, max)).join('');
}

export function collapseWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isUserOwnedTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 && trimmed !== UNNAMED_DOCUMENT_TITLE;
}

export function normalizeAgentTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clipped = clipChars(collapseWs(raw.replace(/^["「『]|["」』]$/g, '')), DOCUMENT_AGENT_TITLE_MAX);
  if (clipped.length === 0 || clipped === UNNAMED_DOCUMENT_TITLE) return null;
  return clipped;
}

export function normalizeAgentDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clipped = clipChars(collapseWs(raw), DOCUMENT_DESCRIPTION_MAX);
  return clipped.length > 0 ? clipped : null;
}

export function isTooShortForDocumentMeta(
  contentMd: string,
  minChars = DOCUMENT_META_MIN_CONTENT_CHARS,
): boolean {
  const stripped = contentMd.replace(/\s+/g, '').replace(/[#*_>`~[\]()-]/g, '');
  return [...stripped].length < minChars;
}

export function needsDocumentMeta(row: {
  title: string | null;
  description: string | null;
}): boolean {
  const hasDesc = Boolean(row.description?.trim());
  if (!isUserOwnedTitle(row.title)) return true;
  return !hasDesc;
}

export function resolveDocumentMetaPatch(input: {
  existingTitle: string | null;
  existingDescription: string | null;
  proposedTitle: unknown;
  proposedDescription: unknown;
}): { title?: string | null; description?: string | null } {
  const patch: { title?: string | null; description?: string | null } = {};
  if (!isUserOwnedTitle(input.existingTitle)) {
    const title = normalizeAgentTitle(input.proposedTitle);
    if (title) patch.title = title;
  }
  if (!input.existingDescription?.trim()) {
    const description = normalizeAgentDescription(input.proposedDescription);
    if (description) patch.description = description;
  }
  return patch;
}

export function isEmptyMetaPatch(patch: {
  title?: string | null;
  description?: string | null;
}): boolean {
  return patch.title === undefined && patch.description === undefined;
}

function extractJsonValue(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.search(/[{]/);
  if (start < 0) return undefined;
  const sliced = raw.slice(start);
  try {
    return JSON.parse(sliced);
  } catch {
    const end = sliced.lastIndexOf('}');
    if (end <= 0) return undefined;
    try {
      return JSON.parse(sliced.slice(0, end + 1));
    } catch {
      return undefined;
    }
  }
}

/** Parse an LLM/tool payload into raw title/description fields (may be missing). */
export function parseDocumentMetaProposal(text: string): {
  title: unknown;
  description: unknown;
} {
  const value = extractJsonValue(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { title: undefined, description: undefined };
  }
  const rec = value as Record<string, unknown>;
  return { title: rec.title, description: rec.description };
}

export const DOCUMENT_META_SYSTEM_PROMPT =
  '你是文档元信息生成器。只输出 JSON 对象，不要 markdown，不要解释。';

export function documentMetaUserPrompt(input: {
  contentMd: string;
  keepTitle: boolean;
  existingTitle: string | null;
}): string {
  const keep = input.keepTitle
    ? `已有标题「${input.existingTitle ?? ''}」，title 必须输出 null，只写 description。`
    : 'title：不超过 20 个字的名词短语，概括主题，不要复读原文第一句。';
  return `请为下面这篇学习材料写元信息。只输出 JSON：{"title":"...或null","description":"...或null"}

规则：
- ${keep}
- description 不超过 60 个字，一两句说清这篇讲了什么。
- 内容太短或无从概括时，对应字段用 null。

正文：
${input.contentMd}`;
}
