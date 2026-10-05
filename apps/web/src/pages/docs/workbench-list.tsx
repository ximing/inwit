import { agentDocumentMetaLabel, docCardFace, docCardLabel, type DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronDown, FilePlus, Loader2, Plus, Search, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AiSpark, AiStageText } from '@/components/ai-flow';
import { DocumentActions, useDocumentMenu } from '@/components/document-actions';
import { DocRowSummary } from '@/components/doc-row';
import { SearchPalette, SearchService } from '@/components/search';
import { ScreenshotButton } from '@/components/screenshot-button';
import { Tag } from '@/components/tag';
import { Tip } from '@/components/tip';
import { formatRelativeTime } from '@/lib/format';
import { prefetchDocument } from '@/lib/document-prefetch';
import { isPdfMime } from '@/lib/mime';
import { CaptureEditor } from '@/components/capture/capture-editor';
import { docsPath } from '@/routes';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { DocListResizer } from './doc-list-resizer';
import { DocsService } from './docs.service';
import { prefetchPdfPane } from './pdf-pane-loader';
import { TopicPicker } from './topic-picker';

function warmDocument(doc: DocumentListItem): void {
  prefetchDocument(doc.id);
  if (isPdfMime(doc.fileMime)) prefetchPdfPane();
}

function transferHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/* AI 等待态阶段文案（T28，设计稿 ingest-ai.html 画板 1/2） */
const CAPTURE_STAGES_AUTO = ['正在收下这句话…', '落成一篇文档…', '排队等 AI 消化…'];
const CAPTURE_STAGES_CHAT = ['正在理解你的问题…', '翻你的卡片找答案…', '落成一篇回答…'];
const UPLOAD_DONE_STAGES = ['上传完成，交给 AI…', '正在读这篇文档…', '稍后会提炼成卡片…'];

/** 消化完成回落：pending → 非 pending 且非 failed 时让卡数淡入一次（T28 目标 5）。 */
function useJustDigested(status: DocumentListItem['status']): boolean {
  const prevRef = useRef(status);
  const [justDigested, setJustDigested] = useState(false);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev === 'pending' && status !== 'pending' && status !== 'failed') {
      setJustDigested(true);
    }
    prevRef.current = status;
  }, [status]);
  return justDigested;
}

function rowKindTag(
  doc: DocumentListItem,
  stage: { kind: string; label: string; pulse: boolean },
): { tone: 'ai' | 'busy'; label: string; pulse?: boolean } | null {
  if (stage.kind !== 'idle' && stage.kind !== 'failed' && stage.label) {
    return { tone: 'busy', label: stage.label, pulse: stage.pulse };
  }
  const agent = agentDocumentMetaLabel(doc.source, doc.title, doc.kind);
  if (agent) return { tone: 'ai', label: agent };
  if (doc.source === 'chat') return { tone: 'ai', label: 'AI 回答' };
  return null;
}

const DocStreamRow = observer(function DocStreamRow({
  doc,
  selected,
}: {
  doc: DocumentListItem;
  selected: boolean;
}) {
  const service = useService(DocsService);
  const navigate = useNavigate();
  const menu = useDocumentMenu(doc, (change) => {
    service.applyDocumentChange(change);
    if (!change.document && selected) navigate(docsPath(), { replace: true });
  }, () => navigate(docsPath(doc.id)), () => service.prepareDocumentChange(doc.id));
  const stage = service.stageFor(doc);
  const kind = rowKindTag(doc, stage);
  const face = docCardFace(doc, 120);
  // \u5206\u949f\u7ea7\u540e\u53f0\u9636\u6bb5\uff08\u4e0a\u4f20/\u63d0\u53d6/\u8bc6\u522b/\u6d88\u5316\uff09\uff1a\u884c\u5de6\u7ad6\u5411\u6d41\u5149\u8fb9 + busy tag shimmer\uff08T28\uff09
  const digesting =
    stage.kind === 'upload' ||
    stage.kind === 'extract' ||
    stage.kind === 'ocr' ||
    stage.kind === 'digest';
  const justDigested = useJustDigested(doc.status);
  const tags = (
    <>
      {kind ? (
        <Tag tone={kind.tone}>
          {kind.pulse ? <AiSpark /> : null}
          {kind.pulse ? <span className="shimmer-text">{kind.label}</span> : kind.label}
        </Tag>
      ) : null}
      {doc.status === 'failed' ? (
        <Tip content={doc.failReason ?? undefined}>
          <span className="doc-failed">失败{doc.failReason ? `：${doc.failReason}` : ''}</span>
        </Tip>
      ) : null}
    </>
  );
  const hasTags = Boolean(kind || doc.status === 'failed');
  return (
    <div
      className={`row ws-doc-row${selected ? ' is-on' : ''}${face.title ? '' : ' is-untitled'}${digesting ? ' is-digesting' : ''}`}
      {...menu}
    >
      <Link
        to={docsPath(doc.id)}
        className="ws-doc-row-link"
        aria-label={docCardLabel(face)}
        onPointerEnter={() => warmDocument(doc)}
        onFocus={() => warmDocument(doc)}
      >
        {face.title ? (
          <div className="row-title">
            <span className="t">{face.title}</span>
            {tags}
          </div>
        ) : hasTags ? (
          <div className="row-title is-chips">{tags}</div>
        ) : null}
        <DocRowSummary doc={doc} />
        <div className="row-meta">
          {doc.source === 'import' ? <Tag className="tag-import">导入</Tag> : null}
          {doc.source === 'screenshot' ? <Tag className="tag-import">截图</Tag> : null}
          {doc.topicTitle ? <Tag tone="topic">{doc.topicTitle}</Tag> : null}
          {doc.cardCount > 0 ? (
            <span className={justDigested ? 'card-count' : undefined}>{doc.cardCount} 卡</span>
          ) : null}
          {doc.cardCount > 0 ? <span>·</span> : null}
          <span>{formatRelativeTime(doc.updatedAt)}</span>
        </div>
      </Link>
      {stage.canCancel || stage.canRetry ? (
        <div className="ws-doc-row-ops">
          {stage.canCancel ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.cancelingId === doc.id}
              onClick={() => void service.cancelImport(doc.id)}
            >
              {service.cancelingId === doc.id ? '取消中…' : '取消'}
            </button>
          ) : null}
          {stage.canRetry ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.retryingId === doc.id}
              onClick={() => void service.retryFailed(doc.id)}
            >
              {service.retryingId === doc.id ? '重试中…' : '重试'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export const WorkbenchList = observer(function WorkbenchList({ selectedId }: { selectedId: string | null }) {
  const service = useService(DocsService);
  const search = useService(SearchService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [sendMode, setSendMode] = useState<'auto' | 'chat'>('auto');

  useEffect(() => {
    const root = scrollRef.current;
    const target = moreRef.current;
    if (!root || !target || !service.hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void service.loadMore();
      },
      { root, rootMargin: '120px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [service, service.hasMore, service.documents.length]);

  const sending = service.$model.send.loading;
  const creating = service.$model.createBlank.loading;
  const importing = service.importing;
  const busy = creating || importing;
  const uploadPercent =
    service.uploadingDocumentId !== null
      ? (service.uploadByDoc[service.uploadingDocumentId]?.percent ?? null)
      : null;
  // 分片传完、completeImport 未返回的窗口：切「交给 AI」阶段轮播，不再显示百分比
  const uploadDone = uploadPercent !== null && uploadPercent >= 100;
  const askClass = ['btn', 'btn-ghost', service.draftLooksLikeQuestion ? 'is-accent' : '']
    .filter(Boolean)
    .join(' ');

  const submit = async (mode: 'auto' | 'chat') => {
    setSendMode(mode);
    const id = await service.send(mode);
    if (id) navigate(docsPath(id));
  };

  const createBlank = async () => {
    if (busy) return;
    const id = await service.createBlank();
    if (id) {
      prefs.setDocMode('edit');
      navigate(docsPath(id));
    }
  };

  const importOne = async (file: File) => {
    if (busy) return;
    const id = await service.importFile(file);
    if (id) navigate(docsPath(id));
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void importOne(file);
  };

  const swallowFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(event)) return;
    event.preventDefault();
  };

  const scrollClass = [
    'ws-scroll',
    dropActive ? 'is-drop' : '',
    importing ? 'is-busy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // 列表头：常驻主题筛选下拉框 + 全局搜索弹窗入口
  const filterTopic = service.topics.find((topic) => topic.id === service.filterTopicId) ?? null;

  const openSearchPalette = () => {
    search.openSurface();
    requestAnimationFrame(() => search.focusInput());
  };

  const pickFilter = (id: string | null) => {
    service.closeListFilterMenu();
    void service.setFilter(id);
  };

  return (
    <DocumentActions><div className="ws-list" onDragOver={swallowFileDrop} onDrop={swallowFileDrop}>
      {service.importError ? (
        <div className="ws-alert" role="alert">
          <p>{service.importError}</p>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="关闭"
            onClick={() => service.dismissImportError()}
          >
            <X width={14} height={14} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
      <div className="ws-capture">
        <div className={sending ? 'ai-shell' : undefined}>
          <div className="capture">
            <CaptureEditor
              placeholder="扔一句话进来，或以问号结尾问 AI…"
              disabled={sending}
              onTextChange={(text) => service.setDraft(text)}
              onSubmit={() => void submit('auto')}
              onReady={(handle) => service.bindCapture(handle)}
            />
            <div className="capture-bar">
              <TopicPicker
                topics={service.topics}
                topicId={service.captureTopicId}
                open={service.topicMenuOpen}
                onToggle={() => service.toggleTopicMenu()}
                onSelect={(id) => service.selectCaptureTopic(id)}
                onNew={() => service.openNewTopic('capture')}
              />
              <div className="capture-actions">
                <ScreenshotButton topicId={service.captureTopicId} />
                <button
                  type="button"
                  className={askClass}
                  disabled={!service.canSend}
                  onClick={() => void submit('chat')}
                >
                  {sending ? '提问中…' : '问 AI'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!service.canSend}
                  onClick={() => void submit('auto')}
                >
                  {sending ? '投入中…' : '扔进去'}
                </button>
              </div>
            </div>
          </div>
        </div>
        {sending ? (
          <div className="ai-status" role="status">
            <AiSpark delay={0.3} />
            <AiStageText
              stages={sendMode === 'chat' ? CAPTURE_STAGES_CHAT : CAPTURE_STAGES_AUTO}
            />
          </div>
        ) : null}
        {service.error ? (
          <p className="banner-error" role="alert">
            {service.error}
          </p>
        ) : null}
      </div>

      <div className="ws-listhead">
        <div className="ws-filter-wrap">
          <button
            type="button"
            className={`ws-filter-select${service.filterTopicId ? ' is-filtered' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={service.listFilterMenuOpen}
            onClick={() => service.toggleListFilterMenu()}
          >
            <span className={`dot${service.filterTopicId ? '' : ' is-all'}`} />
            <span className="lbl">{filterTopic?.title ?? '全部主题'}</span>
            <span className="cnt">{service.documentsTotal}</span>
            <ChevronDown width={10} height={10} strokeWidth={2.4} aria-hidden />
          </button>
          {service.listFilterMenuOpen ? (
            <div className="topic-menu ws-filter-menu" role="listbox" aria-label="按主题筛选">
              <button
                type="button"
                role="option"
                aria-selected={service.filterTopicId === null}
                className={service.filterTopicId === null ? 'is-on' : undefined}
                onClick={() => pickFilter(null)}
              >
                <span className="dot is-all" />
                全部主题
              </button>
              {service.topics.map((topic) => (
                <Tip key={topic.id} content={topic.goal ?? topic.title}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={service.filterTopicId === topic.id}
                    className={service.filterTopicId === topic.id ? 'is-on' : undefined}
                    onClick={() => pickFilter(topic.id)}
                  >
                    <span className="dot" />
                    {topic.title}
                  </button>
                </Tip>
              ))}
              <div className="topic-menu-sep" />
              <button
                type="button"
                className="topic-menu-new"
                onClick={() => {
                  service.closeListFilterMenu();
                  service.openNewTopic('filter');
                }}
              >
                ＋ 新建主题
              </button>
            </div>
          ) : null}
        </div>
        <Tip content="搜索（⌘K）">
          <button
            type="button"
            className="ws-head-icon"
            aria-label="搜索"
            onClick={openSearchPalette}
          >
            <Search width={14} height={14} strokeWidth={1.8} />
          </button>
        </Tip>
        <div className="ws-plus-wrap">
          <Tip content="新建 / 导入">
            <button
              type="button"
              className={`ws-head-icon${service.listPlusOpen ? ' is-on' : ''}`}
              aria-label="新建或导入"
              aria-haspopup="menu"
              aria-expanded={service.listPlusOpen}
              onClick={() => service.toggleListPlus()}
            >
              <Plus width={14} height={14} strokeWidth={1.8} />
            </button>
          </Tip>
          {service.listPlusOpen ? (
            <div className="topic-menu ws-plus-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  service.closeListPlus();
                  void createBlank();
                }}
              >
                <FilePlus width={14} height={14} strokeWidth={1.8} />
                {creating ? '正在新建…' : '新建文档'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                aria-busy={importing}
                onClick={() => {
                  service.closeListPlus();
                  fileRef.current?.click();
                }}
              >
                {importing ? (
                  <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                ) : (
                  <Upload width={14} height={14} strokeWidth={1.8} />
                )}
                {importing ? '导入中…' : '导入文件'}
              </button>
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.epub,.txt,.md"
            hidden
            aria-label="选择要导入的文件"
            onChange={(event) => {
              const file = event.target.files?.item(0);
              event.target.value = '';
              if (file) void importOne(file);
            }}
          />
        </div>
      </div>

      <div
        className={scrollClass}
        ref={scrollRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {service.$model.boot.loading || service.$model.loadDocuments.loading ? (
          <p className="ws-importing" role="status">
            <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
            正在加载文档…
          </p>
        ) : null}
        {importing ? (
          <div className="ws-upload" role="status">
            <div className={`ai-shell ws-upload-shell${uploadDone ? ' is-slow' : ''}`}>
              <div className="ai-shell-inner ws-upload-inner">
                <AiSpark />
                <span className="ws-upload-name">{service.importingName}</span>
                {!uploadDone && uploadPercent !== null ? (
                  <span className="ws-upload-pct">{uploadPercent}%</span>
                ) : null}
                {service.uploadingDocumentId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={service.cancelingId === service.uploadingDocumentId}
                    onClick={() => {
                      const id = service.uploadingDocumentId;
                      if (id) void service.cancelImport(id);
                    }}
                  >
                    取消
                  </button>
                ) : null}
              </div>
            </div>
            <div className="ai-status">
              <AiSpark delay={uploadDone ? 0.5 : 0.3} />
              {uploadDone ? (
                <AiStageText stages={UPLOAD_DONE_STAGES} />
              ) : (
                <span className="shimmer-text">正在上传…</span>
              )}
            </div>
          </div>
        ) : null}
        {service.documents.length === 0 && !service.$model.boot.loading && !service.$model.loadDocuments.loading && !importing ? (
          <p className="hint">这张纸还是空的。扔一句话进来。</p>
        ) : null}
        {service.documents.map((doc) => (
          <DocStreamRow key={doc.id} doc={doc} selected={doc.id === selectedId} />
        ))}
        {service.hasMore ? (
          <div ref={moreRef} className="ws-more">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={service.$model.loadMore.loading}
              onClick={() => void service.loadMore()}
            >
              {service.$model.loadMore.loading ? (
                <>
                  <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                  载入中…
                </>
              ) : (
                '更早的文档'
              )}
            </button>
          </div>
        ) : null}
      </div>
      <SearchPalette />
      <DocListResizer />
    </div></DocumentActions>
  );
});
