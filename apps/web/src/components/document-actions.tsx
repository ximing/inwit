import { bindServices, observer, useService } from '@rabjs/react';
import { docDisplayTitle, type DocumentListItem } from '@inwit/dto';
import { Copy, FolderInput, Pencil, RotateCw, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DocumentActionsService, type DocumentChange } from './document-actions.service';
import './document-actions.css';

export function useDocumentMenu(doc: DocumentListItem, onChange: (change: DocumentChange) => void, onOpen: () => void, beforeChange?: () => Promise<void>) {
  const service = useService(DocumentActionsService);
  const open = (target: HTMLElement, x: number, y: number) => {
    (target.querySelector<HTMLElement>('a, button') ?? target).focus();
    service.open(doc, x, y, onChange, onOpen, beforeChange);
  };
  return {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      event.stopPropagation();
      open(event.currentTarget, event.clientX, event.clientY);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      open(event.currentTarget, rect.left + 16, rect.top + 16);
    },
  };
}

const ActionsContent = observer(function ActionsContent({ children }: { children: ReactNode }) {
  const service = useService(DocumentActionsService);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const active = service.menu !== null || service.dialog !== null;

  useLayoutEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const closeMenu = () => { if (service.menu) service.close(); };
    const pointer = (event: PointerEvent) => {
      if (service.menu && !menuRef.current?.contains(event.target as Node)) service.close();
    };
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Tab' && service.dialog) {
        const dialog = dialogRef.current;
        const elements = Array.from(dialog?.querySelectorAll<HTMLElement>(
          'input:not(:disabled), select:not(:disabled), button:not(:disabled)',
        ) ?? []);
        const first = elements[0];
        const last = elements[elements.length - 1];
        const outside = !dialog?.contains(document.activeElement);
        if (!first || outside || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last ?? dialog : first ?? dialog)?.focus();
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        service.close();
      }
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', closeMenu);
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', scroll, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [active, service]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !service.menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(service.menu.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(service.menu.y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }, [service.menu, service.error]);

  useLayoutEffect(() => {
    if (!service.dialog) return;
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled)',
    ) ?? dialog)?.focus();
  }, [service.dialog]);



  useEffect(() => {
    if (!service.notice) return;
    const timer = window.setTimeout(() => { service.notice = null; }, 2500);
    return () => window.clearTimeout(timer);
  }, [service, service.notice]);

  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Tab') { service.close(); return; }
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  };
  const dialogTitle = service.dialog === 'rename' ? '重命名文档' : service.dialog === 'move' ? '移动到主题' : service.dialog === 'retry' ? '重试处理' : '删除文档';
  return <>
    {children}
    {createPortal(<>
      {service.menu && <div ref={menuRef} className="document-context-menu" role="menu" aria-label="文档操作" onKeyDown={menuKeys} onContextMenu={(event) => event.preventDefault()}>
        <button role="menuitem" disabled={service.busy} onClick={() => { service.close(); service.onOpen(); }}><SquareArrowOutUpRight />打开</button>
        <button role="menuitem" disabled={service.busy} onClick={() => service.showDialog('rename')}><Pencil />重命名</button>
        <button role="menuitem" disabled={service.busy} onClick={() => service.showDialog('move')}><FolderInput />移动到主题</button>
        <button role="menuitem" disabled={service.busy} onClick={() => void service.copyLink()}><Copy />复制链接</button>
        {service.doc?.status === 'failed' && <button role="menuitem" disabled={service.busy} onClick={() => service.showDialog('retry')}><RotateCw />重试处理</button>}
        <div className="document-menu-separator" role="separator" />
        <button role="menuitem" className="is-danger" disabled={service.busy} onClick={() => service.showDialog('delete')}><Trash2 />删除</button>
        {service.error && <p role="alert">{service.error}</p>}
      </div>}
      {service.dialog && <div className="document-action-backdrop" onClick={(event) => { if (event.target === event.currentTarget) service.close(); }}>
        <div ref={dialogRef} className="document-action-dialog" role="dialog" aria-modal="true" aria-label={dialogTitle} tabIndex={-1}>
          <h2>{dialogTitle}</h2>
          <form onSubmit={(event) => { event.preventDefault(); void service.submit(); }}>
            {service.dialog === 'rename' && <label>文档名称<input value={service.title} maxLength={500} required disabled={service.busy} onChange={(event) => { service.title = event.target.value; }} /></label>}
            {service.dialog === 'move' && <label>目标主题<select value={service.topicId} disabled={service.busy || service.topicsLoading || !service.topicsLoaded} onChange={(event) => { service.topicId = event.target.value; }}>
              <option value="">不属于任何主题</option>
              {service.doc?.topicId && !service.topics.some((topic) => topic.id === service.doc?.topicId) && <option value={service.doc.topicId} disabled>{service.doc.topicTitle ?? '当前主题'}（不可选）</option>}
              {service.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </select>{service.topicsLoading && <span>加载主题中…</span>}</label>}
            {service.dialog === 'delete' && <p>确定把「{service.doc ? docDisplayTitle(service.doc) : ''}」移入回收站？文档、批注和卡片会被隐藏，30 天内可在设置页恢复。</p>}
            {service.dialog === 'retry' && <p>重新处理「{service.doc ? docDisplayTitle(service.doc) : ''}」。</p>}
            {service.error && <p className="banner-error" role="alert">{service.error}</p>}
            {service.dialog === 'move' && !service.topicsLoaded && !service.topicsLoading && <button type="button" className="btn btn-ghost" onClick={() => void service.loadTopics()}>重新加载主题</button>}
            <div className="document-action-buttons">
              <button type="button" className="btn btn-ghost" disabled={service.busy} onClick={() => service.close()}>取消</button>
              <button type="submit" className={`btn ${service.dialog === 'delete' ? 'document-delete-button' : 'btn-primary'}`} disabled={service.busy || (service.dialog === 'move' && (!service.topicsLoaded || service.topicsLoading || service.topicId === (service.doc?.topicId ?? '')))}>{service.busy ? '处理中…' : service.dialog === 'delete' ? '移入回收站' : '确定'}</button>
            </div>
          </form>
        </div>
      </div>}
      {service.notice && <div className="document-action-notice" role="status">{service.notice}</div>}
    </>, document.body)}
  </>;
});

export const DocumentActions = bindServices(ActionsContent, [DocumentActionsService]);
