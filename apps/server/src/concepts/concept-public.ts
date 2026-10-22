import type { Concept, ConceptEvidence, ConceptRelation } from '@inwit/dto';
import type { ConceptEvidenceRow, ConceptRelationRow, ConceptRow } from '../db/schema.js';

export function toPublicConcept(row: ConceptRow): Concept {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    name: row.name,
    aliases: row.aliases,
    sense: row.sense,
    definition: row.definition,
    example: row.example,
    origin: row.origin,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPublicRelation(row: ConceptRelationRow): ConceptRelation {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    fromConceptId: row.fromConceptId,
    toConceptId: row.toConceptId,
    kind: row.kind,
    predicate: row.predicate,
    context: row.context,
    explanation: row.explanation,
    example: row.example,
    origin: row.origin,
    basis: row.basis,
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPublicEvidence(row: ConceptEvidenceRow): ConceptEvidence {
  return {
    id: row.id,
    userId: row.userId,
    conceptId: row.conceptId,
    relationId: row.relationId,
    documentId: row.documentId,
    documentTitleSnapshot: row.documentTitleSnapshot,
    documentHash: row.documentHash,
    quote: row.quote,
    locator: row.locator,
    basis: row.basis,
    availability: row.availability,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
