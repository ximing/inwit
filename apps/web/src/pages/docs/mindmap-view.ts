/** 脑图镜头和搜索。只活在这次打开里，切文章时收起，回来再放出来。 */

export interface MindView {
  panX: number;
  panY: number;
  zoom: number;
}

export interface MindCanvasSession {
  view: MindView;
  searchQuery: string;
  searchOpen: boolean;
  searchIndex: number;
  todoOnly: boolean;
}

export const DEFAULT_MIND_VIEW: MindView = { panX: 28, panY: 28, zoom: 1 };

const sessions = new Map<string, MindCanvasSession>();

export function emptyMindSession(): MindCanvasSession {
  return {
    view: { ...DEFAULT_MIND_VIEW },
    searchQuery: '',
    searchOpen: false,
    searchIndex: 0,
    todoOnly: false,
  };
}

export function rememberMindSession(documentId: string, session: MindCanvasSession): void {
  sessions.set(documentId, {
    ...session,
    view: { ...session.view },
  });
}

export function mindSessionFor(documentId: string | null): MindCanvasSession {
  if (!documentId) return emptyMindSession();
  const saved = sessions.get(documentId);
  if (!saved) return emptyMindSession();
  return { ...saved, view: { ...saved.view } };
}

export function resetMindSessions(): void {
  sessions.clear();
}
