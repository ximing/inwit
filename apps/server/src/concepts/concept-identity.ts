import { createHash } from 'node:crypto';
import type { ConceptEvidenceLocator, ConceptMatch } from '@inwit/dto';

/**
 * 名称/谓词/语境的规范化：NFKC、去首尾空白、连续空白折叠、小写。
 * 仅用于匹配建议与身份哈希，不改变存储的展示值；不移除标点。
 */
export function normalizeConceptName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export const normalizePredicate = normalizeConceptName;
export const normalizeContext = normalizeConceptName;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 键序稳定的 JSON 序列化（对象键排序、数组保持顺序）。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** 关系身份：同用户同主题内 源/目标/类型/规范化谓词/规范化语境 唯一。 */
export function relationIdentityHash(input: {
  userId: string;
  topicId: string;
  fromConceptId: string;
  toConceptId: string;
  kind: string;
  predicate: string;
  context: string | null | undefined;
}): string {
  return sha256Hex(
    stableStringify([
      input.userId,
      input.topicId,
      input.fromConceptId,
      input.toConceptId,
      input.kind,
      normalizePredicate(input.predicate),
      normalizeContext(input.context ?? ''),
    ]),
  );
}

function canonicalLocator(locator: ConceptEvidenceLocator): Record<string, unknown> {
  switch (locator.kind) {
    case 'block':
      return {
        kind: 'block',
        blockIndex: locator.blockIndex,
        quote: locator.quote,
        prefix: locator.prefix ?? '',
        suffix: locator.suffix ?? '',
      };
    case 'pdf':
      return { kind: 'pdf', pageNumber: locator.pageNumber, quote: locator.quote };
    case 'quote':
      return { kind: 'quote', quote: locator.quote };
  }
}

/** 证据去重：目标 + 文档 + 正文 hash + 规范化定位 + 引文。 */
export function evidenceDedupeHash(input: {
  targetKind: 'concept' | 'relation';
  targetId: string;
  documentId: string;
  documentHash: string;
  locator: ConceptEvidenceLocator;
}): string {
  return sha256Hex(
    stableStringify([
      input.targetKind,
      input.targetId,
      input.documentId,
      input.documentHash,
      canonicalLocator(input.locator),
    ]),
  );
}

/** 幂等请求哈希：同一 requestId 的请求体一致性判定。 */
export function requestHashOf(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export interface ConceptMatchInput {
  id: string;
  name: string;
  sense: string | null;
  aliases: string[];
}

/**
 * 同名/别名匹配：规范化名称相同，或任一侧别名与对方名称/别名相交。
 * 只产出建议，不做合并决定。
 */
export function conceptMatchKind(
  input: { name: string; aliases: string[] },
  existing: ConceptMatchInput,
): ConceptMatch['matchedBy'] | null {
  const targetName = normalizeConceptName(input.name);
  const targetAliases = new Set(input.aliases.map(normalizeConceptName));
  const existingName = normalizeConceptName(existing.name);
  const existingAliases = new Set(existing.aliases.map(normalizeConceptName));
  if (existingName === targetName) return 'name';
  if (existingAliases.has(targetName)) return 'alias';
  for (const alias of targetAliases) {
    if (alias === existingName || existingAliases.has(alias)) return 'alias';
  }
  return null;
}

/** 可见集合 + 范围 + 图版本的游标绑定哈希。 */
export function graphViewScopeHash(input: {
  userId: string;
  topicId: string;
  documentId: string | null;
  nodeIds: string[];
}): string {
  return sha256Hex(
    stableStringify([
      input.userId,
      input.topicId,
      input.documentId ?? '',
      [...input.nodeIds].sort(),
    ]),
  );
}
