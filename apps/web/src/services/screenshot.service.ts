import { Service } from '@rabjs/react';
import type { Document, ScreenshotInitInput } from '@inwit/dto';
import { completeScreenshot, initScreenshot } from '@/api/documents';
import { errorMessage } from '@/api/client';
import { isTauriRuntime, tauriFetch } from '@/api/tauri';

const TOAST_MS = 3200;

function pngBlobFromBase64(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

function localShotTitle(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `截图 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export class ScreenshotService extends Service {
  capturing = false;
  toast: string | null = null;
  error: string | null = null;
  lastDocument: Document | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private unlisten: Array<() => void> = [];

  constructor() {
    super();
    if (isTauriRuntime()) void this.attach();
  }

  get available(): boolean {
    return isTauriRuntime();
  }

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  private async attach(): Promise<void> {
    const { listen } = await import('@tauri-apps/api/event');
    this.unlisten.push(
      await listen<string>('screenshot-captured', (event) => {
        void this.ingestPng(event.payload);
      }),
    );
    this.unlisten.push(
      await listen<string>('screenshot-failed', (event) => {
        this.error = event.payload;
      }),
    );
  }

  async capture(topicId?: string | null): Promise<void> {
    if (!isTauriRuntime() || this.capturing) return;
    this.error = null;
    this.capturing = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string | null>('capture_region');
      if (b64) await this.ingestPng(b64, topicId);
    } catch (err) {
      this.error = errorMessage(err, '截图失败');
    } finally {
      this.capturing = false;
    }
  }

  async fromClipboard(topicId?: string | null): Promise<void> {
    if (!isTauriRuntime() || this.capturing) return;
    this.error = null;
    this.capturing = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string | null>('clipboard_image');
      if (!b64) {
        this.error = '剪贴板里没有图片';
        return;
      }
      await this.ingestPng(b64, topicId);
    } catch (err) {
      this.error = errorMessage(err, '读取剪贴板失败');
    } finally {
      this.capturing = false;
    }
  }

  async ingestPng(b64: string, topicId?: string | null): Promise<void> {
    this.error = null;
    const blob = pngBlobFromBase64(b64);
    const input: ScreenshotInitInput = {
      contentType: 'image/png',
      sizeBytes: blob.size,
      title: localShotTitle(),
      ...(topicId ? { topicId } : {}),
    };
    try {
      const { document, uploadUrl } = await initScreenshot(input);
      const putFetch = isTauriRuntime() ? tauriFetch : fetch.bind(globalThis);
      const put = await putFetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'image/png' },
      });
      if (!put.ok) {
        this.error = '截图上传失败';
        return;
      }
      this.lastDocument = await completeScreenshot(document.id);
      this.showToast('已收下，正在识别');
    } catch (err) {
      this.error = errorMessage(err, '截图捕捉失败');
    }
  }

  override destroy(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    for (const stop of this.unlisten) stop();
    super.destroy();
  }
}
