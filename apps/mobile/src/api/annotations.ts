import type {
  Annotation,
  AnnotationImageResponse,
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from '@inwit/dto';
import { request } from './client';

export function listDocumentAnnotations(documentId: string): Promise<Annotation[]> {
  return request<Annotation[]>(`/api/documents/${documentId}/annotations`);
}

export function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  return request<Annotation>('/api/annotations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAnnotation(id: string, input: UpdateAnnotationInput): Promise<Annotation> {
  return request<Annotation>(`/api/annotations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteAnnotation(id: string): Promise<void> {
  return request<void>(`/api/annotations/${id}`, { method: 'DELETE' });
}

export function getAnnotationImage(id: string): Promise<AnnotationImageResponse> {
  return request<AnnotationImageResponse>(`/api/annotations/${id}/image`);
}
