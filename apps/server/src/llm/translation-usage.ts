import type { TranslationModelSnapshot, TranslationUsage } from '@inwit/dto';
import { getDb } from '../db/index.js';
import { llmUsageLogs } from '../db/schema.js';
/** Durable result usage is authoritative. This additional audit log is idempotent by task. */
export async function logTranslationUsage(
  userId: string,
  model: TranslationModelSnapshot,
  usage: TranslationUsage,
  taskId?: string,
): Promise<void> {
  try {
    await getDb()
      .insert(llmUsageLogs)
      .values({
        userId,
        provider: model.provider,
        model: model.model,
        capability: 'translation',
        translationTaskId: taskId ?? null,
        usageStatus: usage.usageStatus,
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        costEstimate: 0,
      })
      .onConflictDoNothing();
  } catch {
    /* Result usage remains durable; never log query parameters or credentials. */
  }
}
