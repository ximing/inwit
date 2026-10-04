import { listBodyPreview, type DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { DocsService } from './docs.service';

/**
 * 状态行：只在消化中 / 失败 / 可重试 / 可取消时出现，平时不渲染。
 * 时间挪到了顶行工具丸，卡数由右侧卡片栏展示，这里不再重复。
 */
export const DocPaneMeta = observer(function DocPaneMeta({
  docId,
  status,
  source,
  contentJson,
}: {
  docId: string;
  status: DocumentListItem['status'];
  source: DocumentListItem['source'];
  contentJson?: unknown;
}) {
  const service = useService(DocsService);
  const stage = service.stageFor({
    id: docId,
    status,
    source,
    preview: contentJson === undefined ? null : listBodyPreview(contentJson),
  });
  const stageLabel =
    stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label ? stage.label : null;
  const failed = status === 'failed';
  if (!stageLabel && !failed && !stage.canRetry && !stage.canCancel) return null;
  return (
    <div className="pane-meta">
      {stageLabel ? <span>{stageLabel}</span> : null}
      {failed ? (
        <>
          {stageLabel ? <span className="sep">·</span> : null}
          <span>失败</span>
        </>
      ) : null}
      {stage.canRetry ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={service.retryingId === docId}
          onClick={() => void service.retryFailed(docId)}
        >
          {service.retryingId === docId ? '重试中…' : '重试'}
        </button>
      ) : null}
      {stage.canCancel ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={service.cancelingId === docId}
          onClick={() => void service.cancelImport(docId)}
        >
          {service.cancelingId === docId ? '取消中…' : '取消上传'}
        </button>
      ) : null}
    </div>
  );
});
