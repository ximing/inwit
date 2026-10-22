import { sql, type SQLWrapper } from 'drizzle-orm';
import { check, timestamp } from 'drizzle-orm/pg-core';

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Values are compile-time constants from @inwit/dto, so raw interpolation is safe. */
export const enumCheck = (name: string, column: SQLWrapper, values: readonly string[]) =>
  check(name, sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`);
