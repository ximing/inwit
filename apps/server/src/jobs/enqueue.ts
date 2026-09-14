import type { JobPayload, JobType } from '@inwit/dto';
import type { Database } from '../db/index.js';
import { jobs, type JobRow, type NewJob } from '../db/schema.js';
import { AppError } from '../errors.js';

export type JobWriter = Pick<Database, 'insert'>;

export interface EnqueueJobInput {
  userId: string;
  type: JobType;
  payload: JobPayload;
  runAt?: Date;
}

export async function enqueueJob(db: JobWriter, input: EnqueueJobInput): Promise<JobRow> {
  const values: NewJob = {
    userId: input.userId,
    type: input.type,
    payload: input.payload,
    status: 'pending',
    ...(input.runAt !== undefined ? { runAt: input.runAt } : {}),
  };
  const [row] = await db.insert(jobs).values(values).returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return row;
}
