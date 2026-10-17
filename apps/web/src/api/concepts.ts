import type {
  AddCardKnowledgeLinkInput,
  BindExistingConceptPracticeInput,
  CardKnowledgeLink,
  CommitConceptBatchInput,
  Concept,
  ConceptArchiveResult,
  ConceptBatch,
  ConceptCommitResult,
  ConceptDetail,
  ConceptGraphPage,
  ConceptGraphQuery,
  ConceptGraphViewInput,
  ConceptGraphViewResult,
  ConceptListPage,
  ConceptMatch,
  ConceptNote,
  ConceptPracticeBinding,
  ConceptPracticeProposal,
  ConceptPracticeResult,
  ConceptRelation,
  ConceptRelationDetail,
  CreateConceptBatchInput,
  CreateConceptBatchResult,
  CreateConceptInput,
  CreateConceptPracticeInput,
  CreateConceptPracticeProposalInput,
  CreateConceptPracticeProposalResult,
  CreateConceptRelationInput,
  CreateConceptRelationResult,
  CreateConceptResult,
  DocumentKnowledge,
  DocumentKnowledgeQuery,
  EvidenceResolution,
  KnowledgeLocations,
  KnowledgeLocationsQuery,
  ListConceptsQuery,
  RefreshConceptPracticeInput,
  RelationArchiveResult,
  ResumeConceptPracticeInput,
  SaveConceptBundleInput,
  SaveConceptBundleResult,
  SetDocumentKnowledgeRefInput,
  UpdateConceptInput,
  UpdateConceptNoteInput,
  UpdateConceptRelationInput,
} from '@inwit/dto';
import { request } from './client';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---- 概念 CRUD ----

export function listConcepts(topicId: string, query: ListConceptsQuery): Promise<ConceptListPage> {
  return request(`/api/topics/${topicId}/concepts${qs({ q: query.q, cursor: query.cursor, limit: query.limit, includeArchived: query.includeArchived ? 'true' : undefined })}`);
}

export function createConcept(topicId: string, input: CreateConceptInput): Promise<CreateConceptResult> {
  return request(`/api/topics/${topicId}/concepts`, { method: 'POST', body: JSON.stringify(input) });
}

export function getConcept(id: string): Promise<ConceptDetail> {
  return request(`/api/concepts/${id}`);
}

export function updateConcept(id: string, input: UpdateConceptInput): Promise<Concept> {
  return request(`/api/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveConcept(id: string, expectedVersion: number): Promise<ConceptArchiveResult> {
  return request(`/api/concepts/${id}/archive`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function restoreConcept(id: string, expectedVersion: number): Promise<Concept> {
  return request(`/api/concepts/${id}/restore`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function findConceptMatches(topicId: string, input: { name: string; aliases?: string[] }): Promise<{ matches: ConceptMatch[] }> {
  return request(`/api/topics/${topicId}/concept-matches`, { method: 'POST', body: JSON.stringify(input) });
}

export function saveConceptBundle(topicId: string, input: SaveConceptBundleInput): Promise<SaveConceptBundleResult> {
  return request(`/api/topics/${topicId}/concept-bundles`, { method: 'POST', body: JSON.stringify(input) });
}

// ---- 关系 ----

export function createConceptRelation(topicId: string, input: CreateConceptRelationInput): Promise<CreateConceptRelationResult> {
  return request(`/api/topics/${topicId}/concept-relations`, { method: 'POST', body: JSON.stringify(input) });
}

export function getConceptRelation(id: string): Promise<ConceptRelationDetail> {
  return request(`/api/concept-relations/${id}`);
}

export function updateConceptRelation(id: string, input: UpdateConceptRelationInput): Promise<ConceptRelation> {
  return request(`/api/concept-relations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveConceptRelation(id: string, expectedVersion: number): Promise<RelationArchiveResult> {
  return request(`/api/concept-relations/${id}/archive`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

export function restoreConceptRelation(id: string, expectedVersion: number): Promise<ConceptRelation> {
  return request(`/api/concept-relations/${id}/restore`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
}

// ---- 图 ----

export function getConceptGraph(topicId: string, query: ConceptGraphQuery): Promise<ConceptGraphPage> {
  return request(`/api/topics/${topicId}/concept-graph${qs({ focusId: query.focusId, documentId: query.documentId, cursor: query.cursor, limit: query.limit })}`);
}

export function postConceptGraphView(topicId: string, input: ConceptGraphViewInput): Promise<ConceptGraphViewResult> {
  return request(`/api/topics/${topicId}/concept-graph/view`, { method: 'POST', body: JSON.stringify(input) });
}

// ---- 批次 ----

export function createConceptBatch(documentId: string, input: CreateConceptBatchInput): Promise<CreateConceptBatchResult> {
  return request(`/api/documents/${documentId}/concept-batches`, { method: 'POST', body: JSON.stringify(input) });
}

export function getConceptBatch(id: string): Promise<ConceptBatch> {
  return request(`/api/concept-batches/${id}`);
}

export function updateConceptDraft(id: string, input: { expectedDraftRevision: number; draft: unknown }): Promise<ConceptBatch> {
  return request(`/api/concept-batches/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function commitConceptBatch(id: string, input: CommitConceptBatchInput): Promise<ConceptCommitResult> {
  return request(`/api/concept-batches/${id}/commit`, { method: 'POST', body: JSON.stringify(input) });
}

export function discardConceptBatch(id: string): Promise<ConceptBatch> {
  return request(`/api/concept-batches/${id}/discard`, { method: 'POST' });
}

// ---- 练习 ----

export function createConceptPractice(input: CreateConceptPracticeInput): Promise<ConceptPracticeResult> {
  return request(`/api/concept-practices`, { method: 'POST', body: JSON.stringify(input) });
}

export function bindExistingConceptPractice(input: BindExistingConceptPracticeInput): Promise<ConceptPracticeResult> {
  return request(`/api/concept-practices/bind-existing`, { method: 'POST', body: JSON.stringify(input) });
}

export function refreshConceptPractice(id: string, input: RefreshConceptPracticeInput): Promise<ConceptPracticeBinding> {
  return request(`/api/concept-practices/${id}/refresh`, { method: 'POST', body: JSON.stringify(input) });
}

export function resumeConceptPractice(id: string, input: ResumeConceptPracticeInput): Promise<ConceptPracticeBinding> {
  return request(`/api/concept-practices/${id}/resume`, { method: 'POST', body: JSON.stringify(input) });
}

export function unbindConceptPractice(id: string): Promise<ConceptPracticeBinding> {
  return request(`/api/concept-practices/${id}`, { method: 'DELETE' });
}

export function createConceptPracticeProposal(input: CreateConceptPracticeProposalInput): Promise<CreateConceptPracticeProposalResult> {
  return request(`/api/concept-practice-proposals`, { method: 'POST', body: JSON.stringify(input) });
}

export function getConceptPracticeProposal(id: string): Promise<ConceptPracticeProposal> {
  return request(`/api/concept-practice-proposals/${id}`);
}

// ---- 本文知识（T7a）----

export function getDocumentKnowledge(documentId: string, query: DocumentKnowledgeQuery): Promise<DocumentKnowledge> {
  return request(`/api/documents/${documentId}/knowledge${qs({ topicId: query.topicId, cursor: query.cursor, limit: query.limit })}`);
}

export function setDocumentKnowledgeRef(documentId: string, input: SetDocumentKnowledgeRefInput): Promise<{ refId: string }> {
  return request(`/api/documents/${documentId}/knowledge-refs`, { method: 'POST', body: JSON.stringify(input) });
}

export function removeDocumentKnowledgeRef(documentId: string, refId: string, confirmDependentRelations: boolean): Promise<{ removedRefs: number }> {
  return request(`/api/documents/${documentId}/knowledge-refs/${refId}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmDependentRelations }),
  });
}

export function getKnowledgeLocations(documentId: string, query: KnowledgeLocationsQuery): Promise<KnowledgeLocations> {
  return request(`/api/documents/${documentId}/knowledge-locations${qs(query as unknown as Record<string, string>)}`);
}

export function createConceptNote(input: { targetKind: 'concept' | 'relation'; targetId: string; documentId: string | null; text: string }): Promise<ConceptNote> {
  return request(`/api/concept-notes`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateConceptNote(id: string, input: UpdateConceptNoteInput): Promise<ConceptNote> {
  return request(`/api/concept-notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function resolveConceptEvidence(id: string): Promise<EvidenceResolution> {
  return request(`/api/concept-evidence/${id}/resolve`);
}

// ---- 卡片导航关联 ----

export function listCardKnowledgeLinks(cardId: string): Promise<{ items: CardKnowledgeLink[] }> {
  return request(`/api/cards/${cardId}/knowledge-links`);
}

export function addCardKnowledgeLink(cardId: string, input: AddCardKnowledgeLinkInput): Promise<{ link: CardKnowledgeLink; created: boolean }> {
  return request(`/api/cards/${cardId}/knowledge-links`, { method: 'POST', body: JSON.stringify(input) });
}

export function removeCardKnowledgeLink(cardId: string, linkId: string): Promise<void> {
  return request(`/api/cards/${cardId}/knowledge-links/${linkId}`, { method: 'DELETE' });
}
