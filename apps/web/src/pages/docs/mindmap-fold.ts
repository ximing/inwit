const keyFor = (documentId: string) => `inwit-mindmap-fold:${documentId}`;

export function loadFolds(documentId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(documentId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function saveFolds(documentId: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(keyFor(documentId), JSON.stringify(ids));
  } catch {
    // 隐私模式写不进时，这一次会话里的折叠仍然有效。
  }
}
