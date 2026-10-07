import { Loader2 } from 'lucide-react';

export type PdfLoadStage = 'open' | 'download' | 'engine' | 'read';

function formatMb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** PDF 打开过程的占位：纸形骨架 + 阶段文案，让人知道进行到哪一步。 */
export function PdfLoading({
  stage,
  loaded,
  total,
}: {
  stage: PdfLoadStage;
  loaded?: number | null;
  total?: number | null;
}) {
  let label: string;
  if (stage === 'download' && loaded != null) {
    label =
      total != null && total > 0
        ? `正在下载文档… ${Math.min(99, Math.round((loaded / total) * 100))}%`
        : `正在下载文档… ${formatMb(loaded)}`;
  } else {
    label = {
      open: '正在取得文档…',
      download: '正在下载文档…',
      engine: '正在准备渲染引擎…',
      read: '正在读取文档…',
    }[stage];
  }
  return (
    <div className="pdf-loading" role="status" aria-live="polite">
      <div className="pdf-loading-page" aria-hidden />
      <p className="pdf-loading-label">
        <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
        {label}
      </p>
    </div>
  );
}
