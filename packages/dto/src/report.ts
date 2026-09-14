import { z } from 'zod';

export const weeklyReportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const weeklyReportLatestSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  weekStart: weeklyReportDateSchema,
  weekEnd: weeklyReportDateSchema,
  successRate: z.number().int().min(0).max(100),
  relearnCount: z.number().int().nonnegative(),
  summary: z.string().nullable(),
});
export type WeeklyReportLatest = z.infer<typeof weeklyReportLatestSchema>;

export const weeklyReportLatestResponseSchema = z.object({
  report: weeklyReportLatestSchema.nullable(),
});
export type WeeklyReportLatestResponse = z.infer<typeof weeklyReportLatestResponseSchema>;

/** Home banner copy. Design-system §6.5 / task T23. */
export function weeklyReportBannerText(successRate: number, relearnCount: number): string {
  const rate = `成功率 ${String(successRate)}%`;
  if (relearnCount <= 0) {
    return `📖 本周复盘已生成：${rate}，这周学得很稳。`;
  }
  return `📖 本周复盘已生成：${rate}，有 ${String(relearnCount)} 个概念在偷偷遗忘。`;
}
