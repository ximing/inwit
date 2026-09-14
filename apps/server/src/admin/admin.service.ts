import {
  agentExecutionStepSchema,
  type AdminExecutionDetail,
  type AdminExecutionListItem,
  type Job,
  type ListAdminExecutionsQuery,
  type ListAdminJobsQuery,
  type LlmCapability,
  type Paged,
  type UsageDay,
  type UsageGroup,
  type UsageSummary,
  type UsageTotals,
} from '@inwit/dto';
import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentExecutions, documents, jobs, llmUsageLogs, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import { listJobs, retryJob } from '../jobs/jobs.service.js';
import {
  addTotals,
  asNumber,
  elapsedMs,
  emptyTotals,
  fillDailySeries,
  previewText,
  roundCost,
  usageWindow,
  utcDateKey,
} from './aggregates.js';

export async function listAdminJobs(userId: string, query: ListAdminJobsQuery): Promise<Paged<Job>> {
  const offset = (query.page - 1) * query.limit;
  const result = await listJobs(userId, {
    limit: query.limit,
    offset,
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
  });
  return {
    items: result.items,
    total: result.total,
    page: query.page,
    limit: query.limit,
  };
}

export function retryAdminJob(userId: string, id: string): Promise<Job> {
  return retryJob(userId, id);
}

function toUsageTotals(row: {
  calls: unknown;
  promptTokens: unknown;
  completionTokens: unknown;
  totalTokens: unknown;
  costEstimate: unknown;
}): UsageTotals {
  return {
    calls: asNumber(row.calls),
    promptTokens: asNumber(row.promptTokens),
    completionTokens: asNumber(row.completionTokens),
    totalTokens: asNumber(row.totalTokens),
    costEstimate: roundCost(asNumber(row.costEstimate)),
  };
}

export async function getUsageSummary(
  userId: string,
  days: number,
  now = new Date(),
): Promise<UsageSummary> {
  const { from, to } = usageWindow(days, now);
  const where = and(eq(llmUsageLogs.userId, userId), gte(llmUsageLogs.createdAt, from));

  const groupRows = await getDb()
    .select({
      provider: llmUsageLogs.provider,
      model: llmUsageLogs.model,
      capability: llmUsageLogs.capability,
      calls: sql<number>`count(*)::int`,
      promptTokens: sql<number>`coalesce(sum(${llmUsageLogs.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${llmUsageLogs.completionTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`,
      costEstimate: sql<number>`coalesce(sum(${llmUsageLogs.costEstimate})::float8, 0)`,
    })
    .from(llmUsageLogs)
    .where(where)
    .groupBy(llmUsageLogs.provider, llmUsageLogs.model, llmUsageLogs.capability)
    .orderBy(desc(sql`sum(${llmUsageLogs.totalTokens})`));

  const byModel: UsageGroup[] = groupRows.map((row) => ({
    provider: row.provider,
    model: row.model,
    capability: row.capability,
    ...toUsageTotals(row),
  }));

  const totals = emptyTotals();
  const byCapability: Record<LlmCapability, UsageTotals> = {
    chat: emptyTotals(),
    embed: emptyTotals(),
    rerank: emptyTotals(),
  };
  for (const group of byModel) {
    addTotals(totals, group);
    addTotals(byCapability[group.capability], group);
  }

  const dayExpr = sql<string>`to_char((${llmUsageLogs.createdAt} at time zone 'utc')::date, 'YYYY-MM-DD')`;
  const dayRows = await getDb()
    .select({
      date: dayExpr,
      calls: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`,
      costEstimate: sql<number>`coalesce(sum(${llmUsageLogs.costEstimate})::float8, 0)`,
      chatTokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}) filter (where ${llmUsageLogs.capability} = 'chat'), 0)::int`,
      embedTokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}) filter (where ${llmUsageLogs.capability} = 'embed'), 0)::int`,
      rerankTokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}) filter (where ${llmUsageLogs.capability} = 'rerank'), 0)::int`,
    })
    .from(llmUsageLogs)
    .where(where)
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  const daily: UsageDay[] = fillDailySeries(
    from,
    days,
    dayRows.map((row) => ({
      date: row.date,
      calls: asNumber(row.calls),
      totalTokens: asNumber(row.totalTokens),
      costEstimate: roundCost(asNumber(row.costEstimate)),
      chatTokens: asNumber(row.chatTokens),
      embedTokens: asNumber(row.embedTokens),
      rerankTokens: asNumber(row.rerankTokens),
    })),
  );

  return {
    days,
    from: utcDateKey(from),
    to: utcDateKey(to),
    totals: {
      ...totals,
      byCapability: {
        chat: byCapability.chat,
        embed: byCapability.embed,
        rerank: byCapability.rerank,
      },
    },
    byModel,
    daily,
  };
}

type ExecutionJoinRow = {
  id: string;
  jobId: string | null;
  userId: string;
  userEmail: string;
  agentType: AdminExecutionListItem['agentType'];
  status: AdminExecutionListItem['status'];
  startedAt: Date;
  finishedAt: Date | null;
  resultSummary: string | null;
  error: string | null;
  stepCount: unknown;
  jobType: AdminExecutionListItem['jobType'];
  documentId: string | null;
  documentRaw: string | null;
};

const executionSelect = {
  id: agentExecutions.id,
  jobId: agentExecutions.jobId,
  userId: agentExecutions.userId,
  userEmail: users.email,
  agentType: agentExecutions.agentType,
  status: agentExecutions.status,
  startedAt: agentExecutions.startedAt,
  finishedAt: agentExecutions.finishedAt,
  resultSummary: agentExecutions.resultSummary,
  error: agentExecutions.error,
  stepCount: sql<number>`coalesce(jsonb_array_length(${agentExecutions.steps}), 0)::int`,
  jobType: jobs.type,
  documentId: documents.id,
  documentRaw: documents.contentMd,
};

function executionWhere(userId: string, query: ListAdminExecutionsQuery): SQL {
  const conditions: SQL[] = [eq(agentExecutions.userId, userId)];
  if (query.agentType !== undefined) conditions.push(eq(agentExecutions.agentType, query.agentType));
  if (query.status !== undefined) conditions.push(eq(agentExecutions.status, query.status));
  return and(...conditions)!;
}

function toListItem(row: ExecutionJoinRow, now = new Date()): AdminExecutionListItem {
  return {
    id: row.id,
    jobId: row.jobId,
    userId: row.userId,
    userEmail: row.userEmail,
    agentType: row.agentType,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: elapsedMs(row.startedAt, row.finishedAt, row.status === 'running', now),
    stepCount: asNumber(row.stepCount),
    resultSummary: row.resultSummary,
    error: row.error,
    jobType: row.jobType ?? null,
    documentId: row.documentId ?? null,
    documentPreview: previewText(row.documentRaw),
  };
}

export async function listAdminExecutions(
  userId: string,
  query: ListAdminExecutionsQuery,
): Promise<Paged<AdminExecutionListItem>> {
  const where = executionWhere(userId, query);
  const offset = (query.page - 1) * query.limit;

  const [totalRow] = await getDb().select({ n: count() }).from(agentExecutions).where(where);
  const rows = await getDb()
    .select(executionSelect)
    .from(agentExecutions)
    .innerJoin(users, eq(users.id, agentExecutions.userId))
    .leftJoin(jobs, eq(jobs.id, agentExecutions.jobId))
    .leftJoin(
      documents,
      sql`${documents.id}::text = coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId')`,
    )
    .where(where)
    .orderBy(desc(agentExecutions.startedAt), desc(agentExecutions.id))
    .limit(query.limit)
    .offset(offset);

  return {
    items: rows.map((row) => toListItem(row)),
    total: Number(totalRow?.n ?? 0),
    page: query.page,
    limit: query.limit,
  };
}

export async function getAdminExecution(userId: string, id: string): Promise<AdminExecutionDetail> {
  const [row] = await getDb()
    .select({
      ...executionSelect,
      steps: agentExecutions.steps,
    })
    .from(agentExecutions)
    .innerJoin(users, eq(users.id, agentExecutions.userId))
    .leftJoin(jobs, eq(jobs.id, agentExecutions.jobId))
    .leftJoin(
      documents,
      sql`${documents.id}::text = coalesce(${jobs.payload}->>'documentId', ${jobs.payload}->>'captureId')`,
    )
    .where(and(eq(agentExecutions.id, id), eq(agentExecutions.userId, userId)))
    .limit(1);

  if (!row) throw AppError.of(404, 'EXECUTION_NOT_FOUND');

  const parsed = agentExecutionStepSchema.array().safeParse(row.steps);
  return {
    ...toListItem(row),
    steps: parsed.success ? parsed.data : [],
  };
}
