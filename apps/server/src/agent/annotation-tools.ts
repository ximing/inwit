import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { IMAGE_EXCERPT_QUOTE, type AnnotationKind } from '@inwit/dto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { annotations } from '../db/schema.js';
import { searchAnnotations } from '../retrieval/pipeline.js';
import { clipChars } from '../retrieval/search-logic.js';
import { loadAnnotationsByIds } from '../search/search.service.js';

const ANNOTATION_TOOL_QUOTE_CHARS = 200;
const ANNOTATION_TOOL_NOTE_CHARS = 300;
const ANNOTATION_TOOL_LIMIT = 20;
const ANNOTATION_SEARCH_LIMIT = 8;

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

export type DocumentAnnotationView = {
  kind: AnnotationKind;
  blockIndex: number | null;
  pageIndex: number | null;
  quote: string;
  note: string;
};

/** Annotations the user left on one document, oldest first, clipped for LLM context. */
export async function loadDocumentAnnotationsView(
  userId: string,
  documentId: string,
  limit = ANNOTATION_TOOL_LIMIT,
): Promise<DocumentAnnotationView[]> {
  const rows = await getDb()
    .select()
    .from(annotations)
    .where(and(eq(annotations.userId, userId), eq(annotations.documentId, documentId), isNull(annotations.deletedAt)))
    .orderBy(asc(annotations.createdAt), asc(annotations.id))
    .limit(limit);
  return rows.map((row) => ({
    kind: row.kind,
    blockIndex: row.anchorBlockIndex ?? null,
    pageIndex: row.pageIndex ?? null,
    quote: row.quote === IMAGE_EXCERPT_QUOTE ? '' : clipChars(row.quote, ANNOTATION_TOOL_QUOTE_CHARS),
    note: clipChars(row.note, ANNOTATION_TOOL_NOTE_CHARS),
  }));
}

export const readDocumentAnnotationsSchema = Type.Object({});
export type ReadDocumentAnnotationsArgs = Static<typeof readDocumentAnnotationsSchema>;

/** Read the user's annotations on the job's document (digest / evolve sessions). */
export function readDocumentAnnotationsTool(session: {
  userId: string;
  documentId: string | null;
}): AgentTool<typeof readDocumentAnnotationsSchema> {
  return {
    name: 'read_document_annotations',
    label: '读取本文批注',
    description:
      '读取用户在当前文档上亲手写的批注（引文 + 想法），按创建时间排序。批注标记了用户停顿和困惑的位置，切卡/换讲法前应先读。',
    parameters: readDocumentAnnotationsSchema,
    execute: async () => {
      if (!session.documentId) {
        const payload = {
          annotations: [],
          hint: '这张卡没有关联文档，没有批注可读。',
        };
        return toolResult(JSON.stringify(payload), payload);
      }
      const views = await loadDocumentAnnotationsView(session.userId, session.documentId);
      const payload = {
        annotations: views,
        hint:
          views.length === 0
            ? '用户在这份材料上没有批注。'
            : '批注是用户亲手标记的重点：有批注的块优先切卡；note 里若写有用户的疑问或理解，把它体现进卡片的 confusion_point 或 example，不要原样照抄。',
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}

export const searchAnnotationsSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
});
export type SearchAnnotationsArgs = Static<typeof searchAnnotationsSchema>;

/** Hybrid-search the user's annotations across all documents (chat sessions). */
export function searchAnnotationsTool(session: {
  userId: string;
}): AgentTool<typeof searchAnnotationsSchema> {
  return {
    name: 'search_annotations',
    label: '检索批注',
    description:
      '用自然语言检索用户在所有文档上写的批注（语义 + 关键词混合召回）。回答用户问题时，如问题与阅读经历相关，可用它找用户当时的想法。',
    parameters: searchAnnotationsSchema,
    execute: async (_id, params) => {
      const ids = await searchAnnotations(session.userId, params.query, ANNOTATION_SEARCH_LIMIT);
      const hits = await loadAnnotationsByIds(session.userId, ids);
      const payload = {
        annotations: hits,
        hint:
          hits.length === 0
            ? '没有搜到相关批注。'
            : '这些是用户自己写的批注。回答用到批注内容时，点明出自哪份资料，例如「你在《文档名》里批注过…」。',
      };
      return toolResult(JSON.stringify(payload), payload);
    },
  };
}
