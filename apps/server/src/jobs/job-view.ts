import type {
  JobPayload,
  JobQueueCounts,
  JobStatus,
  JobType,
  JobUsage,
  JobUsageByType,
  JobUsageDay,
} from '@inwit/dto';
import {
  documentIdFromJobPayload,
  evolveJobPayloadFrom,
  topicJobPayloadFrom,
} from '@inwit/dto';
import {
  addLocalDays,
  localDateKey,
  startOfLocalDay,
  startOfLocalDayDaysAgo,
} from '../review/review-logic.js';

export const PENDING_QUEUE_LIMIT = 20;
export const USAGE_DAYS = 7;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JobRelated {
  documentTitle?: string | null;
  question?: string | null;
  topicTitle?: string | null;
}

export interface JobRelatedMaps {
  documentsById: Map<string, { title: string | null }>;
  cardsById: Map<string, { topicId: string | null }>;
  topicsById: Map<string, string>;
}

const GENERIC: Record<JobType, { summary: string; description: string }> = {
  digest: { summary: '消化 · 一篇文档', description: '提取知识卡片并更新知识地图' },
  chat: { summary: '对话 · 一个问题', description: '检索已有卡片后生成回答' },
  weekly_report: { summary: '周报 · 本周', description: '生成本周学习复盘' },
  evolve: { summary: '主题进化 · 一个主题', description: '根据今天的复习表现更新知识地图' },
  topic: { summary: '主题进化 · 一个主题', description: '整理或补全知识地图' },
  selection: { summary: '选段写卡 · 一篇文档', description: '从选中段落生成知识卡片' },
  extract: { summary: '提取 · 一篇文档', description: '从原件提取文本' },
  ocr: { summary: '识别 · 一篇文档', description: '识别扫描版文档中的文字' },
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function onlyUuids(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter(isUuid);
}

function nonempty(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function payloadString(payload: JobPayload, key: string): string | undefined {
  return nonempty(typeof payload[key] === 'string' ? payload[key] : undefined);
}

/** Drop OCR page texts if a leftover `pageTexts` field is still on the row. */
export function publicJobPayload(type: JobType, payload: JobPayload): JobPayload {
  if (type !== 'ocr') return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, 'pageTexts')) return payload;
  const rest = { ...payload };
  delete rest.pageTexts;
  return rest;
}

/** Truncate to `max` Unicode code points. */
export function truncateChars(text: string, max: number): string {
  const chars = [...text.trim().replace(/\s+/g, ' ')];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

export function weeklyRangeLabel(weekStart: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day);
  if (
    start.getFullYear() !== year ||
    start.getMonth() !== month - 1 ||
    start.getDate() !== day
  ) {
    return undefined;
  }
  const end = addLocalDays(start, 6);
  return `${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()}`;
}

export function summarizeJob(
  type: JobType,
  payload: JobPayload,
  related: JobRelated = {},
): { summary: string; description: string } {
  const fallback = GENERIC[type];
  try {
    if (type === 'digest') {
      const title = nonempty(related.documentTitle);
      return {
        summary: title ? `消化 · 「${title}」` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'chat') {
      const question =
        payloadString(payload, 'question') ?? nonempty(related.question) ?? nonempty(related.documentTitle);
      return {
        summary: question ? `对话 · 「${truncateChars(question, 30)}」` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'weekly_report') {
      const weekStart = payloadString(payload, 'weekStart');
      const range = weekStart ? weeklyRangeLabel(weekStart) : undefined;
      return {
        summary: range ? `周报 · ${range}` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'evolve' || type === 'topic') {
      const title = nonempty(related.topicTitle);
      return {
        summary: title ? `主题进化 · 「${title}」` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'selection') {
      const title = nonempty(related.documentTitle);
      return {
        summary: title ? `选段写卡 · 《${title}》` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'extract') {
      const title = nonempty(related.documentTitle);
      return {
        summary: title ? `提取 · 「${title}」` : fallback.summary,
        description: fallback.description,
      };
    }
    if (type === 'ocr') {
      const title = nonempty(related.documentTitle);
      return {
        summary: title ? `识别 · 「${title}」` : fallback.summary,
        description: fallback.description,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function collectRelatedIds(rows: Array<{ type: JobType; payload: JobPayload }>): {
  documentIds: string[];
  topicIds: string[];
  cardIds: string[];
} {
  const documentIds: string[] = [];
  const topicIds: string[] = [];
  const cardIds: string[] = [];
  for (const row of rows) {
    if (
      row.type === 'digest' ||
      row.type === 'chat' ||
      row.type === 'selection' ||
      row.type === 'extract' ||
      row.type === 'ocr'
    ) {
      const documentId = documentIdFromJobPayload(row.payload);
      if (documentId) documentIds.push(documentId);
    }
    if (row.type === 'topic') {
      const topicId = payloadString(row.payload, 'topicId') ?? topicJobPayloadFrom(row.payload)?.topicId;
      if (topicId) topicIds.push(topicId);
    }
    if (row.type === 'evolve') {
      const cardId = payloadString(row.payload, 'cardId') ?? evolveJobPayloadFrom(row.payload)?.cardId;
      if (cardId) cardIds.push(cardId);
      const topicId = payloadString(row.payload, 'topicId');
      if (topicId) topicIds.push(topicId);
    }
  }
  return {
    documentIds: onlyUuids(documentIds),
    topicIds: onlyUuids(topicIds),
    cardIds: onlyUuids(cardIds),
  };
}

export function relatedForJob(
  row: { type: JobType; payload: JobPayload },
  maps: JobRelatedMaps,
): JobRelated {
  const documentId = documentIdFromJobPayload(row.payload);
  const document = documentId ? maps.documentsById.get(documentId) : undefined;
  let topicId = payloadString(row.payload, 'topicId') ?? topicJobPayloadFrom(row.payload)?.topicId;
  if (!topicId) {
    const evolve = evolveJobPayloadFrom(row.payload);
    const cardId = evolve?.cardId ?? payloadString(row.payload, 'cardId');
    if (cardId) {
      const card = maps.cardsById.get(cardId);
      if (card?.topicId) topicId = card.topicId;
    }
  }
  const related: JobRelated = {};
  const documentTitle = nonempty(document?.title);
  if (documentTitle) related.documentTitle = documentTitle;
  const topicTitle = topicId ? nonempty(maps.topicsById.get(topicId)) : undefined;
  if (topicTitle) related.topicTitle = topicTitle;
  return related;
}

export function startedElapsedSec(updatedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 1000));
}

export function isDoneToday(
  status: JobStatus,
  finishedAt: Date | null,
  now: Date,
): boolean {
  if (status !== 'done' || !finishedAt) return false;
  return localDateKey(finishedAt) === localDateKey(now);
}

/** Visible failures: currently `failed` (a retry flips status back to pending). */
export function isVisibleFailed(status: JobStatus): boolean {
  return status === 'failed';
}

export function computeQueueCounts(
  rows: Array<{ status: JobStatus; finishedAt: Date | null }>,
  now: Date,
): JobQueueCounts {
  let running = 0;
  let pending = 0;
  let doneToday = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'running') running += 1;
    else if (row.status === 'pending') pending += 1;
    else if (isVisibleFailed(row.status)) failed += 1;
    if (isDoneToday(row.status, row.finishedAt, now)) doneToday += 1;
  }
  return { running, pending, doneToday, failed };
}

export interface UsageLogInput {
  createdAt: Date;
  tokens: number;
  type: string | null | undefined;
}

function usageDateKeys(now: Date, days: number): string[] {
  const start = startOfLocalDayDaysAgo(now, days - 1);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(localDateKey(addLocalDays(start, i)));
  }
  return keys;
}

export function aggregateJobUsage(
  logs: UsageLogInput[],
  now = new Date(),
  days = USAGE_DAYS,
): JobUsage {
  const keys = usageDateKeys(now, days);
  const fromKey = keys[0] ?? localDateKey(startOfLocalDay(now));
  const toKey = keys[keys.length - 1] ?? localDateKey(now);
  const dailyTokens = new Map<string, number>(keys.map((date) => [date, 0]));
  const typeTokens = new Map<string, number>();
  let total = 0;

  for (const log of logs) {
    const date = localDateKey(log.createdAt);
    if (date < fromKey || date > toKey) continue;
    const tokens = Number.isFinite(log.tokens) ? Math.max(0, Math.floor(log.tokens)) : 0;
    dailyTokens.set(date, (dailyTokens.get(date) ?? 0) + tokens);
    total += tokens;
    const type = nonempty(log.type);
    if (type && tokens > 0) {
      typeTokens.set(type, (typeTokens.get(type) ?? 0) + tokens);
    }
  }

  const daily: JobUsageDay[] = keys.map((date) => ({
    date,
    tokens: dailyTokens.get(date) ?? 0,
  }));
  const byType: JobUsageByType[] = [...typeTokens.entries()]
    .map(([type, tokens]) => ({ type, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.type.localeCompare(b.type));

  return { daily, byType, total };
}
