import AsyncStorage from '@react-native-async-storage/async-storage';
import { Service } from '@rabjs/react';
import {
  SCREENSHOT_MAX_BYTES,
  type ImportInitResponse,
  type ScreenshotMime,
} from '@inwit/dto';
import { ApiError } from '@/api/client';
import {
  abortImport,
  completeImport,
  completeScreenshot,
  destroyDocumentPermanently,
  getDocument,
  initImport,
  initScreenshot,
  presignImportParts,
} from '@/api/documents';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  IMPORT_CHECKPOINT_STORAGE_KEY,
  checkpointPercent,
  importFailMessage,
  importFormatOf,
  importMime,
  isAbortError,
  findResumeCheckpoint,
  parseCheckpointList,
  removeCheckpointFromList,
  screenshotContentType,
  serializeCheckpointList,
  upsertCheckpointList,
  type ImportCheckpoint,
} from '@/lib/import-logic';
import { byteSizeOf, uploadRemainingParts } from '@/lib/import-upload';
import { DocsService } from './docs.service';

type LocalFile = {
  uri: string;
  name: string;
  size: number;
  mime: string;
  lastModified: number;
};

const UNSUPPORTED = '不支持这种文件。目前可以导入 PDF、Word、EPUB、TXT 和 Markdown';

function checkpointFromInit(init: ImportInitResponse, file: LocalFile): ImportCheckpoint {
  return {
    documentId: init.documentId,
    uploadId: init.uploadId,
    key: init.key,
    filename: file.name,
    size: file.size,
    lastModified: file.lastModified,
    parts: [],
  };
}

export class ImportService extends Service {
  uploadByDoc: Record<string, { percent: number; filename: string }> = {};
  importCheckpoints: ImportCheckpoint[] = [];
  importingName: string | null = null;
  uploadingDocumentId: string | null = null;
  cancelingId: string | null = null;
  importAbort: AbortController | null = null;
  private hydratePromise: Promise<void> | null = null;

  get docs(): DocsService {
    return this.resolve(DocsService);
  }

  checkpointFor(documentId: string): ImportCheckpoint | null {
    return this.importCheckpoints.find((item) => item.documentId === documentId) ?? null;
  }

  hydrate(): Promise<void> {
    if (!this.hydratePromise) this.hydratePromise = this.readCheckpoints();
    return this.hydratePromise;
  }

  async pickAndImport(): Promise<string | null> {
    if (this.importingName !== null) {
      this.docs.showToast('有文件正在上传');
      return null;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return null;
    const asset = picked.assets[0];
    if (!asset) return null;
    const ext = asset.name;
    if (importFormatOf(ext) === null && ext.includes('.')) {
      this.docs.showToast(UNSUPPORTED);
      return null;
    }
    const size = byteSizeOf(asset.uri, asset.size);
    if (size <= 0) {
      this.docs.showToast('这个文件是空的');
      return null;
    }
    return this.importLocalFile({
      uri: asset.uri,
      name: asset.name,
      size,
      mime: importMime(asset.name, asset.mimeType),
      lastModified: asset.lastModified,
    });
  }

  async takePhoto(): Promise<string | null> {
    if (this.importingName !== null) {
      this.docs.showToast('有文件正在上传');
      return null;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      this.docs.showToast('没有相机权限');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    return this.importScreenshot(asset.uri, asset.mimeType, asset.fileSize);
  }

  async pickPhoto(): Promise<string | null> {
    if (this.importingName !== null) {
      this.docs.showToast('有文件正在上传');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    return this.importScreenshot(asset.uri, asset.mimeType, asset.fileSize);
  }

  async cancelImport(documentId: string): Promise<void> {
    this.cancelingId = documentId;
    const checkpoint = this.checkpointFor(documentId);
    if (this.uploadingDocumentId === documentId) this.importAbort?.abort();
    try {
      if (checkpoint) await abortImport(documentId, { uploadId: checkpoint.uploadId });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        this.docs.showToast(importFailMessage(err));
      }
    } finally {
      await this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      const had = this.docs.documents.some((doc) => doc.id === documentId);
      this.docs.documents = this.docs.documents.filter((doc) => doc.id !== documentId);
      if (had) this.docs.documentsTotal = Math.max(0, this.docs.documentsTotal - 1);
      this.cancelingId = null;
    }
  }

  override destroy(): void {
    this.importAbort?.abort();
    super.destroy();
  }

  private async readCheckpoints(): Promise<void> {
    try {
      const text = await AsyncStorage.getItem(IMPORT_CHECKPOINT_STORAGE_KEY);
      this.importCheckpoints = parseCheckpointList(text);
    } catch {
      this.importCheckpoints = [];
    }
  }

  private persistChain: Promise<void> = Promise.resolve();

  private enqueuePersist(): void {
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(() => this.persist(this.importCheckpoints));
  }

  private async persist(items: readonly ImportCheckpoint[]): Promise<void> {
    try {
      if (items.length === 0) await AsyncStorage.removeItem(IMPORT_CHECKPOINT_STORAGE_KEY);
      else await AsyncStorage.setItem(IMPORT_CHECKPOINT_STORAGE_KEY, serializeCheckpointList(items));
    } catch {
      // The in-memory copy still resumes this session.
    }
  }

  private rememberCheckpoint(checkpoint: ImportCheckpoint): void {
    const next = upsertCheckpointList(this.importCheckpoints, checkpoint);
    this.importCheckpoints = next;
    this.enqueuePersist();
  }

  private async forgetCheckpoint(documentId: string): Promise<void> {
    const next = removeCheckpointFromList(this.importCheckpoints, documentId);
    this.importCheckpoints = next;
    this.enqueuePersist();
    await this.persistChain;
  }

  private setUploadProgress(documentId: string, percent: number, filename: string): void {
    const current = this.uploadByDoc[documentId];
    if (current && current.percent === percent && current.filename === filename) return;
    this.uploadByDoc = { ...this.uploadByDoc, [documentId]: { percent, filename } };
  }

  private clearUploadProgress(documentId: string): void {
    if (!(documentId in this.uploadByDoc)) return;
    const next = { ...this.uploadByDoc };
    delete next[documentId];
    this.uploadByDoc = next;
  }

  private async importLocalFile(file: LocalFile): Promise<string | null> {
    if (this.importingName !== null) return null;
    await this.hydrate();
    this.importingName = file.name;
    const ac = new AbortController();
    this.importAbort = ac;
    let documentId: string | null = null;
    try {
      let checkpoint = findResumeCheckpoint(
        this.importCheckpoints,
        file.name,
        file.size,
        file.lastModified,
      );
      if (checkpoint) {
        try {
          await getDocument(checkpoint.documentId);
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof ApiError && err.status === 404) {
            await this.forgetCheckpoint(checkpoint.documentId);
            checkpoint = null;
          }
        }
      }
      if (!checkpoint) {
        const topicId = this.docs.actionTopicId;
        const init = await initImport({
          filename: file.name,
          mime: file.mime,
          size: file.size,
          ...(topicId ? { topicId } : {}),
        });
        checkpoint = checkpointFromInit(init, file);
        this.rememberCheckpoint(checkpoint);
      }
      documentId = checkpoint.documentId;
      this.uploadingDocumentId = documentId;
      this.setUploadProgress(documentId, checkpointPercent(checkpoint), file.name);
      try {
        this.docs.ingestCreated(await getDocument(documentId));
      } catch (err) {
        if (isAbortError(err)) throw err;
      }
      const uploadId = checkpoint.uploadId;
      const parts = await uploadRemainingParts({
        uri: file.uri,
        size: file.size,
        completed: checkpoint.parts,
        signal: ac.signal,
        listPartUrls: async (partNumbers) => {
          const res = await presignImportParts(documentId!, { uploadId, partNumbers });
          return res.parts;
        },
        onCheckpoint: (nextParts) => {
          checkpoint = { ...checkpoint!, parts: nextParts };
          this.rememberCheckpoint(checkpoint);
        },
        onProgress: (percent) => {
          if (documentId) this.setUploadProgress(documentId, percent, file.name);
        },
      });
      await completeImport(documentId, { uploadId, parts });
      await this.forgetCheckpoint(documentId);
      this.clearUploadProgress(documentId);
      try {
        this.docs.ingestCreated(await getDocument(documentId));
      } catch (err) {
        if (isAbortError(err)) throw err;
      }
      await this.docs.refreshJobs();
      this.docs.syncPolling();
      return documentId;
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) return null;
      this.docs.showToast(importFailMessage(err));
      return null;
    } finally {
      this.importingName = null;
      this.importAbort = null;
      this.uploadingDocumentId = null;
      if (documentId) this.clearUploadProgress(documentId);
    }
  }

  private async importScreenshot(
    uri: string,
    mimeType: string | null | undefined,
    hintedSize?: number | null,
  ): Promise<string | null> {
    const contentType: ScreenshotMime | null = screenshotContentType(mimeType);
    if (!contentType) {
      this.docs.showToast('请换成 JPG 或 PNG');
      return null;
    }
    const size = byteSizeOf(uri, hintedSize);
    if (size <= 0) {
      this.docs.showToast('读不到这张图片');
      return null;
    }
    if (size > SCREENSHOT_MAX_BYTES) {
      this.docs.showToast('图片太大了');
      return null;
    }
    if (this.importingName !== null) return null;
    this.importingName = '照片';
    this.docs.showToast('正在上传…');
    let documentId: string | null = null;
    try {
      const topicId = this.docs.actionTopicId;
      const init = await initScreenshot({
        contentType,
        sizeBytes: size,
        ...(topicId ? { topicId } : {}),
      });
      documentId = init.document.id;
      const put = await FileSystem.uploadAsync(init.uploadUrl, uri, {
        httpMethod: 'PUT',
        headers: { 'Content-Type': contentType },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (put.status < 200 || put.status >= 300) throw new Error('没传上去');
      const created = await completeScreenshot(documentId);
      this.docs.ingestCreated(created);
      return created.id;
    } catch (err) {
      if (documentId) {
        try {
          await destroyDocumentPermanently(documentId);
        } catch {
          // The failed photo should not stay in the list.
        }
      }
      this.docs.showToast(importFailMessage(err));
      return null;
    } finally {
      this.importingName = null;
    }
  }
}
