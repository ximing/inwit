import {
  DOCUMENT_TITLE_MAX,
  WEEKLY_REPORT_TITLE_MARK,
  type MemoryContent,
  type WeeklyReportLatest,
} from '@inwit/dto';

export const WEEKLY_REPORT_MEMORY_PREFIX = 'weekly_report:';
export const WEEKLY_RELEARN_LIMIT = 3;
export const WEEKLY_ANNOTATION_LIMIT = 10;

export interface WeekReviewCounts {
  remembered: number;
  fuzzy: number;
  forgot: number;
  total: number;
}

export interface WeekTopicCoverage {
  topicId: string;
  title: string;
  totalNodes: number;
  uncoveredNodes: number;
  coveragePct: number;
}

export interface WeekRelearnConcept {
  cardId: string;
  concept: string;
  lapses: number;
  lastFeedback: string | null;
  reason?: string;
}

export interface WeekAnnotationItem {
  id: string;
  documentId: string;
  documentTitle: string | null;
  kind: string;
  quote: string;
  note: string;
}

export interface WeekStats {
  weekStart: string;
  weekEnd: string;
  reviews: WeekReviewCounts;
  successRate: number;
  newCards: number;
  newLinks: number;
  topicCoverage: WeekTopicCoverage[];
  relearn: WeekRelearnConcept[];
  annotations: WeekAnnotationItem[];
  annotationCount: number;
}

export function localDateKey(now: Date): string {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Monday 00:00 local of the calendar week that contains `now`. */
export function startOfWeekMonday(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

/** Next Monday 00:00 local (exclusive end of the week). */
export function endOfWeekExclusive(weekStart: Date): Date {
  const d = new Date(weekStart.getTime());
  d.setDate(d.getDate() + 7);
  return d;
}

export function endOfWeekSunday(weekStart: Date): Date {
  const d = new Date(weekStart.getTime());
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function weekStartKey(now: Date): string {
  return localDateKey(startOfWeekMonday(now));
}

export function weeklyReportMemoryKey(weekStart: string): string {
  return `${WEEKLY_REPORT_MEMORY_PREFIX}${weekStart}`;
}

function mdDate(d: Date): string {
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

/** Title:「M/D–M/D 学习复盘」 */
export function weeklyReportTitle(weekStart: Date): string {
  const end = endOfWeekSunday(weekStart);
  const title = `${mdDate(weekStart)}–${mdDate(end)} ${WEEKLY_REPORT_TITLE_MARK}`;
  const chars = [...title];
  if (chars.length <= DOCUMENT_TITLE_MAX) return title;
  return chars.slice(0, DOCUMENT_TITLE_MAX).join('');
}

export function successRateFromCounts(remembered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((remembered / total) * 100);
}

export function coveragePct(totalNodes: number, uncoveredNodes: number): number {
  if (totalNodes <= 0) return 0;
  const covered = Math.max(0, totalNodes - uncoveredNodes);
  return Math.round((covered / totalNodes) * 100);
}

export function shouldAutoEnqueueWeeklyReport(input: {
  hasJobThisWeek: boolean;
  reviewCount: number;
  newCards: number;
  newLinks: number;
}): boolean {
  if (input.hasJobThisWeek) return false;
  return input.reviewCount > 0 || input.newCards > 0 || input.newLinks > 0;
}

export function weeklyResultSummary(input: {
  document: boolean;
  memory: boolean;
  relearn: number;
  reviews: number;
}): string {
  return `type=weekly_report document=${input.document ? '1' : '0'} memory=${input.memory ? '1' : '0'} relearn=${String(input.relearn)} reviews=${String(input.reviews)}`;
}

export function mentionsDistribution(contentMd: string): boolean {
  return /想起来了/.test(contentMd) && /模糊/.test(contentMd) && /忘了/.test(contentMd);
}

export function dataSummaryMarkdown(stats: WeekStats): string {
  const r = stats.reviews;
  const lines = [
    '## 数据小结',
    '',
    `- 回忆成功率 ${String(stats.successRate)}%（想起来了 ${String(r.remembered)} / 模糊 ${String(r.fuzzy)} / 忘了 ${String(r.forgot)}，共 ${String(r.total)} 次）`,
    `- 复习总次数 ${String(r.total)}`,
    `- 新卡片 ${String(stats.newCards)} 张`,
    `- 新建关联边 ${String(stats.newLinks)} 条`,
    `- 新批注 ${String(stats.annotationCount)} 条`,
  ];
  if (stats.topicCoverage.length === 0) {
    lines.push('- 各主题地图覆盖率：还没有主题地图');
  } else {
    lines.push('- 各主题地图覆盖率：');
    for (const topic of stats.topicCoverage) {
      const covered = Math.max(0, topic.totalNodes - topic.uncoveredNodes);
      lines.push(
        `  - ${topic.title} ${String(topic.coveragePct)}%（${String(covered)}/${String(topic.totalNodes)} 节点）`,
      );
    }
  }
  return lines.join('\n');
}

export function relearnMarkdown(relearn: readonly WeekRelearnConcept[]): string {
  if (relearn.length === 0) return '';
  const lines = ['## 建议重学', ''];
  for (const item of relearn) {
    const reason = item.reason?.trim();
    const link = `[${item.concept}](/cards/${item.cardId})`;
    lines.push(reason ? `- ${link}：${reason}` : `- ${link}`);
  }
  return lines.join('\n');
}

/** Deep link to one annotation inside its document page (consumed by the docs workbench). */
export function annotationDeepLink(documentId: string, annotationId: string): string {
  return `/docs?doc=${documentId}&annotation=${annotationId}`;
}

export function annotationsMarkdown(annotations: readonly WeekAnnotationItem[]): string {
  const noted = annotations.filter((item) => item.note.trim() !== '');
  if (noted.length === 0) return '';
  const lines = ['## 本周批注', ''];
  for (const item of noted) {
    const label = item.documentTitle ?? '未命名文档';
    const link = `[批注](${annotationDeepLink(item.documentId, item.id)})`;
    lines.push(`- ${link}（${label}）：${item.note.trim()}`);
  }
  return lines.join('\n');
}

export function ensureRelearnMarkdownLinks(
  contentMd: string,
  relearn: readonly WeekRelearnConcept[],
): string {
  if (relearn.length === 0) return contentMd;
  const missing = relearn.filter((item) => !contentMd.includes(`/cards/${item.cardId}`));
  if (missing.length === 0) return contentMd;
  const extra = relearnMarkdown(relearn);
  if (!extra) return contentMd;
  return `${contentMd.trim()}\n\n${extra}\n`;
}

export function ensureAnnotationLinks(
  contentMd: string,
  annotations: readonly WeekAnnotationItem[],
): string {
  const noted = annotations.filter((item) => item.note.trim() !== '');
  if (noted.length === 0) return contentMd;
  const missing = noted.filter((item) => !contentMd.includes(`annotation=${item.id}`));
  if (missing.length === 0) return contentMd;
  const extra = annotationsMarkdown(annotations);
  if (!extra) return contentMd;
  return `${contentMd.trim()}\n\n${extra}\n`;
}

export function ensureWeeklyReportBody(contentMd: string, stats: WeekStats): string {
  const trimmed = contentMd.trim();
  const withSummary = mentionsDistribution(trimmed)
    ? trimmed
    : `${dataSummaryMarkdown(stats)}\n\n${trimmed}`.trim();
  return ensureAnnotationLinks(ensureRelearnMarkdownLinks(withSummary, stats.relearn), stats.annotations);
}

export function parseWeeklyReportMemory(content: MemoryContent | undefined | null): {
  documentId: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  title: string | null;
  successRate: number | null;
  relearnCount: number;
  summary: string | null;
} {
  if (!content) {
    return {
      documentId: null,
      weekStart: null,
      weekEnd: null,
      title: null,
      successRate: null,
      relearnCount: 0,
      summary: null,
    };
  }
  const documentId = typeof content.documentId === 'string' ? content.documentId : null;
  const weekStart = typeof content.weekStart === 'string' ? content.weekStart : null;
  const weekEnd = typeof content.weekEnd === 'string' ? content.weekEnd : null;
  const title = typeof content.title === 'string' ? content.title : null;
  const successRate =
    typeof content.successRate === 'number' && Number.isFinite(content.successRate)
      ? Math.min(100, Math.max(0, Math.round(content.successRate)))
      : null;
  const relearnRaw = content.relearn;
  const relearnCount = Array.isArray(relearnRaw)
    ? relearnRaw.length
    : typeof content.relearnCount === 'number'
      ? content.relearnCount
      : 0;
  const summary = typeof content.summary === 'string' ? content.summary : null;
  return { documentId, weekStart, weekEnd, title, successRate, relearnCount, summary };
}

export function toWeeklyReportLatest(input: {
  documentId: string;
  title: string;
  weekStart: string;
  weekEnd: string;
  successRate: number;
  relearnCount: number;
  summary: string | null;
}): WeeklyReportLatest {
  return {
    documentId: input.documentId,
    title: input.title,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    successRate: input.successRate,
    relearnCount: input.relearnCount,
    summary: input.summary,
  };
}

export function defaultWeeklySummary(stats: WeekStats): string {
  const n = stats.relearn.length;
  if (n <= 0) {
    return `本周回忆成功率 ${String(stats.successRate)}%，复习 ${String(stats.reviews.total)} 次。没有明显在遗忘的概念。`;
  }
  const names = stats.relearn.map((item) => item.concept).join('、');
  return `本周回忆成功率 ${String(stats.successRate)}%，复习 ${String(stats.reviews.total)} 次。建议重学：${names}。`;
}
