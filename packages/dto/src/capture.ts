/**
 * @deprecated Captures were replaced by documents in T11.
 * Prefer importing Document types from `./document.js`.
 *
 * `Capture` is a type alias for `Document` (V0 fields `type` / `rawContent` / `lastError`
 * no longer exist; use `source` / `contentMd`).
 */
export type {
  Document as Capture,
  DocumentDetail as CaptureDetail,
  CreateDocumentInput as CreateCaptureInput,
  ListDocumentsQuery as ListCapturesQuery,
  DocumentStatus as CaptureStatus,
} from './document.js';
