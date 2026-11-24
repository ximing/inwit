/** 想法草稿按输入框和文章分开。栏里和浮层各记各的，避免互相覆盖。 */

export interface ThoughtDraft {
  note: string;
  image: { key: string; preview: string } | null;
}

interface SlotDraft {
  draft: ThoughtDraft;
  revision: number;
}

const slots = new Map<string, Map<string, SlotDraft>>();

function bucket(slot: string): Map<string, SlotDraft> {
  let map = slots.get(slot);
  if (!map) {
    map = new Map();
    slots.set(slot, map);
  }
  return map;
}

function revokePreview(preview: string | null | undefined): void {
  if (!preview) return;
  try {
    URL.revokeObjectURL(preview);
  } catch {
    // 测试环境没有 object URL。
  }
}

export function thoughtDraftFor(slot: string, documentId: string): ThoughtDraft {
  const saved = bucket(slot).get(documentId);
  if (!saved || (!saved.draft.note && !saved.draft.image)) return { note: '', image: null };
  return saved.draft;
}

export function thoughtDraftRevision(slot: string, documentId: string): number {
  return bucket(slot).get(documentId)?.revision ?? 0;
}

/** 写入草稿，不抬修订号。返回当前修订，供卸载时判断中途有没有被丢掉。 */
export function putThoughtDraft(slot: string, documentId: string, draft: ThoughtDraft): number {
  const map = bucket(slot);
  const revision = map.get(documentId)?.revision ?? 0;
  if (!draft.note && !draft.image) map.delete(documentId);
  else map.set(documentId, { draft, revision });
  return revision;
}

/** 用户关掉浮层：丢掉这篇的草稿，并抬修订号，避免卸载时又写回去。 */
export function discardThoughtDraft(slot: string, documentId: string): number {
  const map = bucket(slot);
  const prev = map.get(documentId);
  const revision = (prev?.revision ?? 0) + 1;
  revokePreview(prev?.draft.image?.preview);
  map.set(documentId, { draft: { note: '', image: null }, revision });
  return revision;
}

export function resetThoughtDrafts(): void {
  slots.clear();
}
