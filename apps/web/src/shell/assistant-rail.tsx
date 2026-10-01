import { docDisplayTitle, type ConversationAction, type DocumentListItem } from '@inwit/dto';
import { observer, useService } from '@rabjs/react';
import { Loader2, MessageSquare, PanelRightClose, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { listDocuments } from '@/api/documents';
import { searchQuery } from '@/api/search';
import { formatRelativeTime } from '@/lib/format';
import { docsPath, ROUTES, topicDocPath } from '@/routes';
import { EditorPresenceService } from '@/services/editor-presence.service';
import { UiPrefsService } from '@/services/ui-prefs.service';
import {
  ASSISTANT_DOCK_MIN_PX,
  ASSISTANT_WIDTH_DEFAULT,
  assistantWidthFromDrag,
  assistantWidthFromKey,
} from '@/services/ui-prefs-logic';
import { AssistantMarkdown } from './assistant-markdown-view';
import { AssistantService } from './assistant.service';

const MENTION_CAP = 5;

type Mention = { id: string; title: string };

function actionView(
  action: ConversationAction,
  dirtyId: string | null,
  hrefFor: (documentId: string) => string,
): { text: string; href: string } {
  const href = hrefFor(action.documentId);
  if (action.type === 'update_document') {
    if (action.status === 'blocked_dirty') {
      return { text: `《${action.title}》有未保存的修改，这次没有写入`, href };
    }
    if (action.status === 'applied' && dirtyId === action.documentId) {
      return {
        text: `《${action.title}》已写入，但这边还有未保存的修改，正文仍是你的草稿`,
        href,
      };
    }
    if (action.status === 'applied') return { text: `已更新《${action.title}》`, href };
    return {
      text: `没能修改《${action.title}》${action.reason ? `：${action.reason}` : ''}`,
      href,
    };
  }
  if (action.type === 'create_document') return { text: `已新建《${action.title}》`, href };
  return { text: `已写入 ${String(action.count)} 张卡片到《${action.title}》`, href };
}

function mentionTitle(item: DocumentListItem): string {
  const title = item.title?.trim();
  if (title) return docDisplayTitle(item);
  return item.preview?.trim() || '未命名文档';
}

export const AssistantRail = observer(function AssistantRail() {
  const service = useService(AssistantService);
  const prefs = useService(UiPrefsService);
  const presence = useService(EditorPresenceService);
  const location = useLocation();
  const [params] = useSearchParams();
  const topicId = location.pathname === ROUTES.topics ? params.get('topic') : null;
  const docId =
    location.pathname === ROUTES.docs || topicId ? params.get('doc') : null;
  const hrefFor = (id: string) => (topicId ? topicDocPath(topicId, id) : docsPath(id));
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<DocumentListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchTicket = useRef(0);

  useEffect(() => {
    service.setContext(docId);
  }, [service, docId]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prefs.assistantCollapsed || service.historyOpen) return;
    el.scrollTop = el.scrollHeight;
  }, [
    prefs.assistantCollapsed,
    service.historyOpen,
    service.current?.id,
    service.current?.messages.length,
    service.current?.messages.at(-1)?.status,
    service.current?.messages.at(-1)?.content,
    service.current?.messages.at(-1)?.thinking,
    service.current?.messages.at(-1)?.activity,
  ]);

  useEffect(() => {
    if (query === null) return;
    const ticket = ++searchTicket.current;
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const items = query
            ? (await searchQuery(query)).documents
            : (await listDocuments({ limit: 8 })).items;
          if (ticket !== searchTicket.current) return;
          setResults(items.slice(0, 8));
        } catch {
          if (ticket !== searchTicket.current) return;
          setResults([]);
        } finally {
          if (ticket === searchTicket.current) setSearching(false);
        }
      })();
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const overlay = viewport < ASSISTANT_DOCK_MIN_PX;
  const context = service.contextChip;
  const mentionIds = new Set(mentions.map((item) => item.id));
  const chips: Mention[] = [
    ...(context && !mentionIds.has(context.id) ? [context] : []),
    ...mentions,
  ];

  function syncQuery(value: string, caret: number): void {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(match ? (match[1] ?? '') : null);
  }

  function choose(item: DocumentListItem): void {
    if (chips.length >= MENTION_CAP) return;
    const mention = { id: item.id, title: mentionTitle(item) };
    setMentions((current) => (current.some((row) => row.id === mention.id) ? current : [...current, mention]));
    const el = inputRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([^\s@]*)$/, '');
    const next = before + draft.slice(caret);
    setDraft(next);
    setQuery(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = before.length;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function submit(): Promise<void> {
    if (query !== null && results[0] && chips.length < MENTION_CAP) {
      choose(results[0]);
      return;
    }
    const ok = await service.send(
      draft,
      mentions.map((item) => item.id),
    );
    if (!ok) return;
    setDraft('');
    setMentions([]);
    setQuery(null);
  }

  function expand(): void {
    prefs.setAssistantCollapsed(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (prefs.assistantCollapsed) {
    return (
      <button type="button" className="assistant-handle" aria-label="展开对话" aria-expanded={false} onClick={expand}>
        <MessageSquare width={16} height={16} strokeWidth={1.8} />
        <span className="assistant-handle-label">对话</span>
        {service.needsAttention ? <span className="assistant-handle-dot" /> : null}
      </button>
    );
  }

  const width = prefs.assistantWidth;
  const last = service.current?.messages.at(-1);

  return (
    <>
      {overlay ? (
        <button type="button" className="assistant-scrim" aria-label="收起对话" onClick={() => prefs.setAssistantCollapsed(true)} />
      ) : null}
      <aside
        className={overlay ? 'assistant-dock is-overlay' : 'assistant-dock'}
        style={{ '--assistant-width': `${width}px` } as CSSProperties}
        aria-label="对话"
      >
        {overlay ? null : (
          <div
            className="assistant-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整对话栏宽度"
            aria-valuemin={300}
            aria-valuemax={520}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              const startX = event.clientX;
              const startWidth = prefs.assistantWidth;
              const move = (ev: PointerEvent) => {
                prefs.setAssistantWidth(assistantWidthFromDrag(startWidth, startX, ev.clientX));
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onDoubleClick={() => prefs.setAssistantWidth(ASSISTANT_WIDTH_DEFAULT)}
            onKeyDown={(event) => {
              const next = assistantWidthFromKey(prefs.assistantWidth, event.key);
              if (next === null) return;
              event.preventDefault();
              prefs.setAssistantWidth(next);
            }}
          />
        )}
        <header className="assistant-head">
          <h2 className="assistant-title">{service.current?.title || '新对话'}</h2>
          <div className="assistant-head-actions">
            <button type="button" className="assistant-icon" aria-pressed={service.historyOpen} onClick={() => service.toggleHistory()}>
              历史
            </button>
            <button type="button" className="assistant-icon" aria-label="新对话" onClick={() => service.startNew()}>
              <Plus width={16} height={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="assistant-icon"
              aria-label="收起对话"
              onClick={() => prefs.setAssistantCollapsed(true)}
            >
              <PanelRightClose width={16} height={16} strokeWidth={1.8} />
            </button>
          </div>
        </header>
        <div className="assistant-scroll" ref={scrollRef}>
          {service.historyOpen ? (
            service.conversations.length === 0 ? (
              <p className="assistant-empty">还没有对话。</p>
            ) : (
              <ul className="assistant-history">
                {service.conversations.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === service.current?.id ? 'assistant-history-row is-on' : 'assistant-history-row'}
                      onClick={() => void service.open(item.id)}
                    >
                      <span className="assistant-history-title">{item.title || '新对话'}</span>
                      <span className="assistant-history-time">{formatRelativeTime(item.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="assistant-icon"
                      aria-label={`删除${item.title || '这段对话'}`}
                      onClick={() => void service.remove(item.id)}
                    >
                      <Trash2 width={14} height={14} strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !service.current || service.current.messages.length === 0 ? (
            <p className="assistant-empty">可以提问，也可以 @ 一篇文档，让它改写或接着写。</p>
          ) : (
            <ol className="assistant-messages">
              {service.current.messages.map((message) => (
                <li key={message.id} className={message.role === 'user' ? 'assistant-msg is-user' : 'assistant-msg'}>
                  {message.documents.length > 0 ? (
                    <p className="assistant-msg-docs">
                      {message.documents.map((doc) => (
                        <Link key={doc.id} to={hrefFor(doc.id)}>
                          @{doc.title}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                  {message.role === 'assistant' && message.thinking ? (
                    <div className="assistant-thinking">
                      <span className="assistant-thinking-label">思考</span>
                      <AssistantMarkdown text={message.thinking} />
                    </div>
                  ) : null}
                  {message.role === 'assistant' && message.status === 'pending' && !message.content ? (
                    <p className="assistant-pending" role="status">
                      <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                      {message.activity ?? '正在处理…'}
                    </p>
                  ) : null}
                  {message.role === 'assistant' &&
                  message.status === 'pending' &&
                  message.content &&
                  message.activity ? (
                    <p className="assistant-pending" role="status">
                      <Loader2 className="icon-spin" width={14} height={14} strokeWidth={1.8} />
                      {message.activity}
                    </p>
                  ) : null}
                  {message.role === 'assistant' && message.status === 'failed' ? (
                    <div className="assistant-failed">
                      <p>{message.failReason ?? '这次没有完成。'}</p>
                      {last?.id === message.id ? (
                        <button type="button" className="btn btn-ghost" onClick={() => void service.retry(message.id)}>
                          重试
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {message.role === 'assistant' && message.content ? (
                    <AssistantMarkdown text={message.content} live={message.status === 'pending'} />
                  ) : null}
                  {message.role === 'user' && message.content ? (
                    <p className="assistant-body">{message.content}</p>
                  ) : null}
                  {message.actions.length > 0 ? (
                    <ul className="assistant-actions">
                      {message.actions.map((action, index) => {
                        const view = actionView(action, presence.documentId, hrefFor);
                        return (
                          <li key={`${action.documentId}-${String(index)}`}>
                            <Link to={view.href}>{view.text}</Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
        {service.error ? (
          <p className="assistant-error" role="alert">
            {service.error}
          </p>
        ) : null}
        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {chips.length > 0 ? (
            <ul className="assistant-chips">
              {chips.map((chip) => {
                const contextual = context?.id === chip.id && !mentionIds.has(chip.id);
                return (
                  <li key={chip.id}>
                    <span>@{chip.title}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${chip.title}`}
                      onClick={() => {
                        if (contextual) service.dismissContext();
                        else setMentions((current) => current.filter((item) => item.id !== chip.id));
                      }}
                    >
                      <X width={12} height={12} strokeWidth={1.8} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="assistant-input-wrap">
            <textarea
              ref={inputRef}
              value={draft}
              rows={3}
              placeholder="提问，或输入 @ 选择文档"
              aria-label="对话输入"
              disabled={service.busy}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(value);
                syncQuery(value, event.target.selectionStart ?? value.length);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.key === 'Process') return;
                if (event.key === 'Escape' && query !== null) {
                  event.preventDefault();
                  setQuery(null);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              onClick={(event) => syncQuery(draft, event.currentTarget.selectionStart ?? draft.length)}
            />
            {query !== null ? (
              <ul className="assistant-mention" role="listbox" aria-label="选择文档">
                {searching ? <li className="assistant-mention-empty">正在查找…</li> : null}
                {!searching && results.length === 0 ? <li className="assistant-mention-empty">没有匹配的文档</li> : null}
                {results.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => choose(item)}>
                      <span>{mentionTitle(item)}</span>
                      {item.preview ? <small>{item.preview}</small> : null}
                    </button>
                  </li>
                ))}
                {chips.length >= MENTION_CAP ? <li className="assistant-mention-empty">最多 @ 5 篇</li> : null}
              </ul>
            ) : null}
          </div>
          <div className="assistant-compose-bar">
            <span className="assistant-hint">Enter 发送，Shift+Enter 换行</span>
            <button type="submit" className="btn btn-primary" disabled={service.busy || draft.trim().length === 0}>
              发送
            </button>
          </div>
        </form>
      </aside>
    </>
  );
});
