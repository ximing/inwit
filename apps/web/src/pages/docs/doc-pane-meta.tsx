import { listBodyPreview, type DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { AiSpark, AiStageText } from '@/components/ai-flow';
import type { DocPipelineStage } from '@/lib/doc-pipeline';
import { DocsService } from './docs.service';

/** 消化阶段的轮播文案（T28，设计稿 ingest-ai.html 画板 4，与 today 页一致） */
const DIGEST_STAGE_LABELS = ['消化中，正在通读…', '提炼要点…', '写成卡片…'];

/** 进行中的阶段：✦ 呼吸 + shimmer；消化阶段轮播进展文案，上传/识别 label 自带进度。 */
function StageLabel({ stage }: { stage: DocPipelineStage }) {
  if (stage.kind === 'digest') {
    return (
      <span className="pane-stage" role="status">
        <AiSpark />
        <AiStageText stages={DIGEST_STAGE_LABELS} />
      </span>
    );
  }
  if (stage.pulse && stage.label) {
    return (
      <span className="pane-stage" role="status">
        <AiSpark />
        <span className="shimmer-text">{stage.label}</span>
      </span>
    );
  }
  return stage.label ? <span>{stage.label}</span> : null;
}

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
      {stageLabel ? <StageLabel stage={stage} /> : null}
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
