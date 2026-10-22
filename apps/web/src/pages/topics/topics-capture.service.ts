import { Service } from '@rabjs/react';
import type { CaptureEditorHandle } from '@/components/capture/capture-editor';
import { isChatQuestion } from '@inwit/dto';

/**
 * 主题页投喂草稿和捕获编辑器句柄。
 * 不读地图、文档列表，也不订阅同步。不解析 TopicsService。
 */
export class TopicsCaptureService extends Service {
  draft = '';
  captureHandle: CaptureEditorHandle | null = null;

  /** 只改草稿。 */
  setDraft(value: string): void {
    this.draft = value;
  }

  /** 只记下句柄，允许 null。 */
  bindCapture(handle: CaptureEditorHandle | null): void {
    this.captureHandle = handle;
  }

  /**
   * 草稿非空、发送不在进行、当前主题存在且未归档。
   * 发送中与主题由调用方传入。
   */
  canSend(sendLoading: boolean, topic: { status: string } | null): boolean {
    return (
      this.draft.trim().length > 0 &&
      !sendLoading &&
      topic !== null &&
      topic.status !== 'archived'
    );
  }

  get draftLooksLikeQuestion(): boolean {
    return isChatQuestion(this.draft);
  }
}
