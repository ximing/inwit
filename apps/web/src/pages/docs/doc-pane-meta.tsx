import type { DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { formatRelativeTime } from '@/lib/format';
import { DocsService } from './docs.service';

export const DocPaneMeta = observer(function DocPaneMeta({
  docId,
  updatedAt,
  cardCount,
  status,
  source,
  contentMd,
}: {
  docId: string;
  updatedAt: string;
  cardCount: number;
  status: DocumentListItem['status'];
  source: DocumentListItem['source'];
  contentMd?: string;
}) {
  const service = useService(DocsService);
  const stage = service.stageFor({
    id: docId,
    status,
    source,
    contentMd,
  });
  return (
    <div className="pane-meta">
      <span>{formatRelativeTime(updatedAt)}</span>
      <span className="sep">·</span>
      <span>{cardCount} 张卡</span>
      {stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label ? (
        <>
          <span className="sep">·</span>
          <span>{stage.label}</span>
        </>
      ) : null}
      {status === 'failed' ? (
        <>
          <span className="sep">·</span>
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
