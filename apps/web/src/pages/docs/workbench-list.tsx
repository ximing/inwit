import { agentDocumentMetaLabel, docDisplayTitle, type DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { FilePlus, Loader2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Chip } from '@/components/chip';
import { DocRowSummary } from '@/components/doc-row';
import { SearchBox, SearchResults, SearchService } from '@/components/search';
import { ScreenshotButton } from '@/components/screenshot-button';
import { Tag } from '@/components/tag';
import { formatRelativeTime } from '@/lib/format';
import { CaptureEditor } from '@/components/capture/capture-editor';
import { docsPath } from '@/routes';
import { UiPrefsService } from '@/services/ui-prefs.service';
import { DocsService } from './docs.service';
import { TopicPicker } from './topic-picker';

function transferHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
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
  const stage = service.stageFor(doc);
  const kind = rowKindTag(doc, stage);
  return (
    <div className={`row ws-doc-row${selected ? ' is-on' : ''}`}>
      <Link to={docsPath(doc.id)} className="ws-doc-row-link">
        <div className="row-title">
          <span className="t">{docDisplayTitle(doc)}</span>
          {kind ? (
            <Tag tone={kind.tone}>
              {kind.pulse ? <span className="pulse" /> : null}
              {kind.pulse ? '\u00a0' : null}
              {kind.label}
            </Tag>
          ) : null}
          {doc.status === 'failed' ? (
            <span className="doc-failed" title={doc.failReason ?? undefined}>
              失败{doc.failReason ? `：${doc.failReason}` : ''}
            </span>
          ) : null}
        </div>
        <DocRowSummary doc={doc} />
        <div className="row-meta">
          {doc.source === 'import' ? <Tag className="tag-import">导入</Tag> : null}
          {doc.source === 'screenshot' ? <Tag className="tag-import">截图</Tag> : null}
          {doc.topicTitle ? <Tag tone="topic">{doc.topicTitle}</Tag> : null}
          {doc.cardCount > 0 ? <span>{doc.cardCount} 卡</span> : null}
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
  }, [service, service.hasMore, service.documents.length, search.hasQuery]);

  const sending = service.$model.send.loading;
  const creating = service.$model.createBlank.loading;
  const importing = service.importing;
  const busy = creating || importing;
  const uploadPercent =
    service.uploadingDocumentId !== null
      ? (service.uploadByDoc[service.uploadingDocumentId]?.percent ?? null)
      : null;
  const askClass = ['btn', 'btn-ghost', service.draftLooksLikeQuestion ? 'is-accent' : '']
    .filter(Boolean)
    .join(' ');

  const submit = async (mode: 'auto' | 'chat') => {
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

  return (
    <div className="ws-list" onDragOver={swallowFileDrop} onDrop={swallowFileDrop}>
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
        <div className="capture">
          <CaptureEditor
            placeholder="扔一句话进来，或以问号结尾问 AI…"
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
        {service.error ? (
          <p className="banner-error" role="alert">
            {service.error}
          </p>
        ) : null}
      </div>

      <div className="ws-search">
        <SearchBox />
      </div>

      <div className="ws-filters">
        <Chip isOn={service.filterTopicId === null} onClick={() => void service.setFilter(null)}>
          全部
        </Chip>
        {service.topics.map((topic) => (
          <Chip
            key={topic.id}
            isOn={service.filterTopicId === topic.id}
            title={topic.goal ?? topic.title}
            onClick={() => void service.setFilter(topic.id)}
          >
            {topic.title}
          </Chip>
        ))}
        <Chip dashed onClick={() => service.openNewTopic('filter')}>
          ＋ 主题
        </Chip>
      </div>

      <div className="ws-tools">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void createBlank()}
        >
          <FilePlus strokeWidth={1.8} />
          {creating ? '正在新建…' : '新建文档'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          aria-busy={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? <Loader2 className="icon-spin" strokeWidth={1.8} /> : <Upload strokeWidth={1.8} />}
          {importing ? '导入中…' : '导入'}
        </button>
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

      <div
        className={scrollClass}
        ref={scrollRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {search.hasQuery ? (
          <SearchResults />
        ) : (
          <>
            {importing ? (
              <p className="ws-importing">
                <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                正在上传 {service.importingName}
                {uploadPercent !== null ? ` ${uploadPercent}%` : ''}
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
              </p>
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
                  {service.$model.loadMore.loading ? '载入中…' : '更早的文档'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});
