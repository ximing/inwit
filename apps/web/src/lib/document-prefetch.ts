import type { DocumentDetail } from '@inwit/dto';
import { getDocument } from '@/api/documents';

export const DOCUMENT_PREFETCH_TTL_MS = 10_000;
export const DOCUMENT_PREFETCH_MAX_INFLIGHT = 2;

type Slot = {
  at: number;
  pending: boolean;
  promise: Promise<DocumentDetail>;
};

const slots = new Map<string, Slot>();
let queued: string | null = null;

function saveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function pendingCount(): number {
  let count = 0;
  for (const slot of slots.values()) {
    if (slot.pending) count += 1;
  }
  return count;
}

function freshSlot(id: string, now = Date.now()): Slot | null {
  const slot = slots.get(id);
  if (!slot) return null;
  if (now - slot.at >= DOCUMENT_PREFETCH_TTL_MS) {
    slots.delete(id);
    return null;
  }
  return slot;
}

function kick(): void {
  if (pendingCount() >= DOCUMENT_PREFETCH_MAX_INFLIGHT) return;
  const id = queued;
  if (!id) return;
  queued = null;
  if (freshSlot(id)) {
    kick();
    return;
  }
  start(id);
}

function start(id: string): void {
  const at = Date.now();
  const promise = getDocument(id);
  const slot: Slot = { at, pending: true, promise };
  slots.set(id, slot);
  void promise.then(
    () => {
      if (slots.get(id) === slot) slot.pending = false;
      kick();
    },
    () => {
      if (slots.get(id) === slot) slots.delete(id);
      kick();
    },
  );
}

/** Warm GET /api/documents/:id. A later open reuses the same promise. */
export function prefetchDocument(id: string): void {
  if (id.length === 0 || saveDataEnabled()) return;
  if (freshSlot(id)) return;
  if (pendingCount() >= DOCUMENT_PREFETCH_MAX_INFLIGHT) {
    queued = id;
    return;
  }
  start(id);
}

/**
 * The hover prefetch, if it is still inside the TTL.
 * Refresh and save paths keep calling getDocument so they do not read this cache.
 */
export function prefetchedDocument(id: string): Promise<DocumentDetail> | null {
  if (queued === id) {
    queued = null;
    if (!freshSlot(id)) start(id);
  }
  return freshSlot(id)?.promise ?? null;
}

export function dropPrefetchedDocument(id: string): void {
  slots.delete(id);
  if (queued === id) queued = null;
}

export function clearDocumentPrefetch(): void {
  slots.clear();
  queued = null;
}
