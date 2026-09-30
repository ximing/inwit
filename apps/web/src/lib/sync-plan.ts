import type { SyncChange, SyncScope } from '@inwit/dto';

export type ReloadIntent =
  | { kind: 'document'; id: string; op: 'upsert' | 'delete'; body: 'apply' | 'keep' | 'defer' }
  | { kind: 'documents-page' }
  | { kind: 'topic'; id: string; op: 'upsert' | 'delete' }
  | { kind: 'topics-page' }
  | { kind: 'map'; topicId: string }
  | { kind: 'review' }
  | { kind: 'job'; id: string }
  | { kind: 'jobs-page' }
  | { kind: 'report' }
  | { kind: 'suggest' }
  | { kind: 'resurface' }
  | { kind: 'reset-mounted' };

export type EchoStamp = {
  scope: SyncScope;
  resourceId: string | null;
  /** Milliseconds from `Date.parse`. Do not compare raw ISO strings. */
  atMs: number;
};

export type SyncView = {
  documents: { id: string; updatedAt: string }[];
  openDocumentId: string | null;
  listIncludesHead: boolean;
  editor: {
    id: string;
    updatedAt: string;
    bodyDirty: boolean;
    titleDirty: boolean;
    saveInflight: boolean;
  } | null;
  topics: { id: string }[];
  openTopicId: string | null;
  mapTopicId: string | null;
  readerDocumentId: string | null;
  readerActiveCardId: string | null;
  reviewInSession: boolean;
  jobs: { id: string; updatedAt: string }[];
  activeJobId: string | null;
};

const POLL_DELAYS_MS = [2_000, 4_000, 8_000, 30_000] as const;

/** Healthy poll is 2000. Each consecutive failure steps 4000, 8000, then 30000. */
export function nextPollDelayMs(failures: number): number {
  const index = failures <= 0 ? 0 : Math.min(Math.floor(failures), POLL_DELAYS_MS.length - 1);
  return POLL_DELAYS_MS[index] ?? 30_000;
}

/** One stamp consumes one upsert. A delete is not an echo of our own write. */
export function stripEchoes(changes: SyncChange[], echoes: EchoStamp[]): SyncChange[] {
  const left = new Map<string, number>();
  for (const echo of echoes) {
    const key = echoKey(echo.scope, echo.resourceId, echo.atMs);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  const kept: SyncChange[] = [];
  for (const change of changes) {
    if (change.op !== 'delete') {
      const key = echoKey(change.scope, change.resourceId, Date.parse(change.at));
      const remaining = left.get(key) ?? 0;
      if (remaining > 0) {
        left.set(key, remaining - 1);
        continue;
      }
    }
    kept.push(change);
  }
  return kept;
}

/** After echoes are gone, one row per scope + resourceId: the greatest id. */
export function coalesceChanges(changes: SyncChange[]): SyncChange[] {
  const winners = new Map<string, SyncChange>();
  for (const change of changes) {
    const key = groupKey(change.scope, change.resourceId);
    const prev = winners.get(key);
    if (!prev || idGreater(change.id, prev.id)) winners.set(key, change);
  }
  return [...winners.values()].sort((a, b) => compareIds(a.id, b.id));
}

/**
 * Do not drop an upsert because the local document stamp is newer than `at`.
 * Card, annotation, and review fan-out use the child row's time.
 */
export function planReloads(changes: SyncChange[], view: SyncView): ReloadIntent[] {
  const intents: ReloadIntent[] = [];
  const seen = new Set<string>();
  const push = (intent: ReloadIntent): void => {
    const key = intentKey(intent);
    if (seen.has(key)) return;
    seen.add(key);
    intents.push(intent);
  };

  for (const change of changes) {
    switch (change.scope) {
      case 'document':
        pushDocument(change, view, push);
        break;
      case 'topic':
        pushTopic(change, view, push);
        break;
      case 'map':
        pushMap(change, view, push);
        break;
      case 'review':
        push({ kind: 'review' });
        break;
      case 'job':
        if (change.resourceId !== null) push({ kind: 'job', id: change.resourceId });
        break;
      case 'report':
      case 'suggest':
      case 'resurface':
        push({ kind: change.scope });
        break;
      default: {
        const unexpected: never = change.scope;
        void unexpected;
      }
    }
  }
  return intents;
}

export function classifyRemoteDetail(input: {
  capturedGen: number;
  currentGen: number;
  dirty: boolean;
  inflight: boolean;
  detailUpdatedAtMs: number;
  /** Document stamp already stored from a PUT/POST. Null when no save has succeeded. */
  floorUpdatedAtMs: number | null;
}): 'drop' | 'merge-keep-body' | 'merge-seed-body' {
  if (input.capturedGen !== input.currentGen) return 'drop';
  // A snapshot from before the local save cannot seed cards or annotations either.
  if (input.floorUpdatedAtMs !== null && input.detailUpdatedAtMs < input.floorUpdatedAtMs) {
    return 'drop';
  }
  if (input.dirty || input.inflight) return 'merge-keep-body';
  // Equal to the floor still merges: card edits do not move the document stamp.
  return 'merge-seed-body';
}

export function planDroppedDocumentReplay(input: {
  dropped: boolean;
  writeInflight: boolean;
  recoveryInflight: boolean;
}): 'none' | 'wait' | 'start' {
  if (!input.dropped) return 'none';
  if (input.writeInflight || input.recoveryInflight) return 'wait';
  return 'start';
}

export function reviewReloadMode(inSession: boolean): 'stats' | 'queue' {
  return inSession ? 'stats' : 'queue';
}

function pushDocument(
  change: SyncChange,
  view: SyncView,
  push: (intent: ReloadIntent) => void,
): void {
  const id = change.resourceId;
  if (id !== null && documentKnown(view, id)) {
    push({ kind: 'document', id, op: change.op, body: documentBody(view, id) });
    return;
  }
  // Unknown ids only refresh a list whose window still starts at offset 0.
  if (view.listIncludesHead) push({ kind: 'documents-page' });
}

function pushTopic(
  change: SyncChange,
  view: SyncView,
  push: (intent: ReloadIntent) => void,
): void {
  const id = change.resourceId;
  if (id !== null && topicKnown(view, id)) {
    push({ kind: 'topic', id, op: change.op });
    return;
  }
  push({ kind: 'topics-page' });
}

function pushMap(
  change: SyncChange,
  view: SyncView,
  push: (intent: ReloadIntent) => void,
): void {
  const topicId = change.resourceId;
  if (topicId !== null && topicKnown(view, topicId)) {
    push({ kind: 'map', topicId });
    return;
  }
  push({ kind: 'topics-page' });
}

function documentKnown(view: SyncView, id: string): boolean {
  if (view.openDocumentId === id || view.readerDocumentId === id || view.editor?.id === id) {
    return true;
  }
  return view.documents.some((doc) => doc.id === id);
}

function documentBody(view: SyncView, id: string): 'apply' | 'keep' | 'defer' {
  const editor = view.editor;
  if (!editor || editor.id !== id) return 'apply';
  if (editor.saveInflight) return 'defer';
  if (editor.bodyDirty) return 'keep';
  return 'apply';
}

function topicKnown(view: SyncView, id: string): boolean {
  if (view.openTopicId === id || view.mapTopicId === id) return true;
  return view.topics.some((topic) => topic.id === id);
}

function intentKey(intent: ReloadIntent): string {
  switch (intent.kind) {
    case 'document':
      return `document\0${intent.id}\0${intent.op}\0${intent.body}`;
    case 'topic':
      return `topic\0${intent.id}\0${intent.op}`;
    case 'map':
      return `map\0${intent.topicId}`;
    case 'job':
      return `job\0${intent.id}`;
    default:
      return intent.kind;
  }
}

function echoKey(scope: string, resourceId: string | null, atMs: number): string {
  return `${scope}\0${resourceId ?? ''}\0${atMs}`;
}

function groupKey(scope: string, resourceId: string | null): string {
  return `${scope}\0${resourceId ?? ''}`;
}

function idGreater(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b);
}

function compareIds(a: string, b: string): number {
  const diff = BigInt(a) - BigInt(b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}
