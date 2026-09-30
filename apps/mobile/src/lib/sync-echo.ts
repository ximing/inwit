import type { SyncChange } from '@inwit/dto';
import { stripEchoes, type EchoStamp } from './sync-plan';

/** One stored stamp per upsert `stripEchoes` removed. Deletes stay, and so do their stamps. */
export function consumeEchoes(changes: SyncChange[], echoes: EchoStamp[]): SyncChange[] {
  const kept = stripEchoes(changes, echoes);
  const keptSet = new Set(kept);
  for (const change of changes) {
    if (change.op === 'delete' || keptSet.has(change)) continue;
    const atMs = Date.parse(change.at);
    const index = echoes.findIndex(
      (echo) =>
        echo.scope === change.scope &&
        echo.resourceId === change.resourceId &&
        echo.atMs === atMs,
    );
    if (index >= 0) echoes.splice(index, 1);
  }
  return kept;
}
