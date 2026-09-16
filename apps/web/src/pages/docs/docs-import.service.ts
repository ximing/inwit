import { Service } from '@rabjs/react';
import {
  FORMAT_BY_EXT,
  MIME_BY_FORMAT,
  type DocumentDetail,
} from '@inwit/dto';
import { ApiError, errorMessage } from '@/api/client';
import {
  abortImport,
  completeImport,
  getDocument,
  initImport,
  presignImportParts,
} from '@/api/documents';
import {
  checkpointPercent,
  findCheckpointForFile,
  loadCheckpoints,
  removeCheckpoint,
  upsertCheckpoint,
  type ImportCheckpoint,
} from '@/lib/multipart-logic';
import {
  checkpointFromInit,
  isAbortError,
  uploadRemainingParts,
} from '@/lib/multipart-upload';
import { DocsService } from './docs.service';

function fileExt(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function mimeOf(file: File): string {
  const fromFile = file.type.split(';')[0]?.trim() ?? '';
  if (fromFile.length > 0) return fromFile;
  const format = FORMAT_BY_EXT[fileExt(file.name)];
  return format ? MIME_BY_FORMAT[format] : 'application/octet-stream';
}

export function importFailMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 415 || err.code === 'IMPORT_UNSUPPORTED_TYPE') {
      return '不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown';
    }
    if (err.status === 413) {
      return '文件太大了';
    }
    if (err.code === 'STORAGE_NOT_CONFIGURED') {
      return '文件存储还没配好';
    }
    if (err.code === 'DOCUMENT_NOT_RETRYABLE') {
      return '这篇现在不能重试';
    }
    if (err.code === 'IMPORT_EMPTY') {
      return '这个文件里没有可提取的文字';
    }
    if (err.code === 'IMPORT_PARTS_MISMATCH') {
      return '分片不完整，请重新上传';
    }
    if (err.status === 422 || err.code === 'IMPORT_PARSE_FAILED') {
      return '这个文件解析失败了，可能已加密或损坏';
    }
  }
  return errorMessage(err, '导入失败');
}

export class DocsImportService extends Service {
  importError: string | null = null;
  importingName: string | null = null;
  uploadByDoc: Record<string, { percent: number; filename: string }> = {};
  importCheckpoints: ImportCheckpoint[] = [];
  importAbort: AbortController | null = null;
  uploadingDocumentId: string | null = null;
  cancelingId: string | null = null;

  get docs(): DocsService {
    return this.resolve(DocsService);
  }

  get importing(): boolean {
    return this.importingName !== null;
  }

  hydrateCheckpoints(): void {
    this.importCheckpoints = loadCheckpoints();
  }

  abortInFlight(): void {
    this.importAbort?.abort();
  }

  checkpointFor(documentId: string): ImportCheckpoint | null {
    return this.importCheckpoints.find((item) => item.documentId === documentId) ?? null;
  }

  rememberCheckpoint(checkpoint: ImportCheckpoint): void {
    upsertCheckpoint(checkpoint);
    const rest = this.importCheckpoints.filter((item) => item.documentId !== checkpoint.documentId);
    this.importCheckpoints = [...rest, checkpoint];
  }

  forgetCheckpoint(documentId: string): void {
    removeCheckpoint(documentId);
    this.importCheckpoints = this.importCheckpoints.filter((item) => item.documentId !== documentId);
  }

  setUploadProgress(documentId: string, percent: number, filename: string): void {
    const current = this.uploadByDoc[documentId];
    if (current && current.percent === percent && current.filename === filename) return;
    this.uploadByDoc = { ...this.uploadByDoc, [documentId]: { percent, filename } };
  }

  clearUploadProgress(documentId: string): void {
    if (!(documentId in this.uploadByDoc)) return;
    const next = { ...this.uploadByDoc };
    delete next[documentId];
    this.uploadByDoc = next;
  }

  dismissImportError(): void {
    this.importError = null;
  }

  async importFile(file: File): Promise<string | null> {
    if (this.importingName !== null) return null;
    this.importError = null;
    const ext = fileExt(file.name);
    if (ext && !FORMAT_BY_EXT[ext]) {
      this.importError = importFailMessage(
        new ApiError(415, 'IMPORT_UNSUPPORTED_TYPE', '不支持的文件类型'),
      );
      return null;
    }
    if (file.size <= 0) {
      this.importError = '这个文件是空的';
      return null;
    }

    this.importingName = file.name;
    const ac = new AbortController();
    this.importAbort = ac;
    let documentId: string | null = null;

    try {
      let checkpoint = findCheckpointForFile(file.name, file.size, file.lastModified);
      let existing: DocumentDetail | null = null;
      if (checkpoint) {
        try {
          existing = await getDocument(checkpoint.documentId);
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof ApiError && err.status === 404) {
            this.forgetCheckpoint(checkpoint.documentId);
            checkpoint = null;
          }
        }
      }

      if (!checkpoint) {
        const init = await initImport({
          filename: file.name,
          mime: mimeOf(file),
          size: file.size,
          ...(this.docs.actionTopicId ? { topicId: this.docs.actionTopicId } : {}),
        });
        checkpoint = checkpointFromInit(init, file);
        this.rememberCheckpoint(checkpoint);
      }

      documentId = checkpoint.documentId;
      this.uploadingDocumentId = documentId;
      this.setUploadProgress(documentId, checkpointPercent(checkpoint), file.name);

      if (existing && existing.id === documentId) {
        this.docs.ingestCreated(existing);
      } else {
        try {
          this.docs.ingestCreated(await getDocument(documentId));
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }

      const uploadId = checkpoint.uploadId;
      const parts = await uploadRemainingParts({
        file,
        checkpoint,
        listPartUrls: async (partNumbers) => {
          const res = await presignImportParts(documentId!, {
            uploadId,
            partNumbers,
          });
          return res.parts;
        },
        signal: ac.signal,
        onCheckpoint: (next) => {
          checkpoint = next;
          this.rememberCheckpoint(next);
        },
        onProgress: (percent) => {
          if (documentId) this.setUploadProgress(documentId, percent, file.name);
        },
      });

      const created = await completeImport(documentId, { uploadId, parts });
      this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      this.docs.ingestCreated(created);
      await this.docs.refreshJobs();
      this.docs.syncPolling();
      return created.id;
    } catch (err) {
      if (isAbortError(err)) return null;
      this.importError = importFailMessage(err);
      return documentId;
    } finally {
      this.importingName = null;
      this.importAbort = null;
      this.uploadingDocumentId = null;
      if (documentId) this.clearUploadProgress(documentId);
    }
  }

  async cancelImport(documentId: string): Promise<void> {
    this.cancelingId = documentId;
    const checkpoint = this.checkpointFor(documentId);
    if (this.uploadingDocumentId === documentId) this.importAbort?.abort();
    try {
      if (checkpoint) await abortImport(documentId, { uploadId: checkpoint.uploadId });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        this.docs.showToast(errorMessage(err, '没取消掉'));
      }
    } finally {
      this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      const had = this.docs.documents.some((doc) => doc.id === documentId);
      this.docs.documents = this.docs.documents.filter((doc) => doc.id !== documentId);
      if (had) this.docs.documentsTotal = Math.max(0, this.docs.documentsTotal - 1);
      if (this.docs.doc?.id === documentId) this.docs.closeDoc();
      this.cancelingId = null;
    }
  }
}
