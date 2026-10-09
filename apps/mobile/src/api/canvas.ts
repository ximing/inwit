import type {
  Annotation,
  CanvasNode,
  CanvasRevision,
  CreateCanvasNodeInput,
  CreateCanvasNoteInput,
  SetCanvasNodeInput,
} from '@inwit/dto';
import { request } from './client';

export async function listCanvasNodes(documentId: string): Promise<CanvasNode[]> {
  const body = await request<{ nodes: CanvasNode[] }>(`/api/documents/${documentId}/canvas`);
  return body.nodes;
}

export function createCanvasNode(
  documentId: string,
  input: CreateCanvasNodeInput,
): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/documents/${documentId}/canvas`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createCanvasNote(
  documentId: string,
  input: CreateCanvasNoteInput,
): Promise<{ annotation: Annotation; node: CanvasNode }> {
  return request<{ annotation: Annotation; node: CanvasNode }>(
    `/api/documents/${documentId}/canvas/notes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function updateCanvasNode(
  documentId: string,
  nodeId: string,
  input: SetCanvasNodeInput,
): Promise<CanvasNode> {
  return request<CanvasNode>(`/api/documents/${documentId}/canvas/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCanvasNode(documentId: string, nodeId: string): Promise<void> {
  return request<void>(`/api/documents/${documentId}/canvas/${nodeId}`, { method: 'DELETE' });
}

export async function listCanvasRevisions(documentId: string): Promise<CanvasRevision[]> {
  const body = await request<{ revisions: CanvasRevision[] }>(
    `/api/documents/${documentId}/canvas/revisions`,
  );
  return body.revisions;
}

export function restoreCanvasRevision(documentId: string, revisionId: string): Promise<CanvasRevision> {
  return request<CanvasRevision>(
    `/api/documents/${documentId}/canvas/revisions/${revisionId}/restore`,
    { method: 'POST' },
  );
}
