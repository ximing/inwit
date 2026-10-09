import type { CanvasRevision } from '@inwit/dto';
import { CheckCheck, Pause, Play, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/format';

/**
 * 画布内搜索。命中数与当前序由父组件算好，这里只管输入与按键。
 */
export function CanvasSearch({
  query,
  matchCount,
  matchIndex,
  onQuery,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  matchCount: number;
  matchIndex: number;
  onQuery: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="canvas-search" role="search">
      <Search width={13} height={13} strokeWidth={1.8} aria-hidden />
      <input
        ref={inputRef}
        value={query}
        placeholder="在脑图里找…"
        aria-label="在脑图里找"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrev();
            else onNext();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="canvas-search-count" aria-live="polite">
        {query.trim() ? (matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : '无命中') : ''}
      </span>
      <button type="button" aria-label="关闭搜索" onClick={onClose}>
        <X width={13} height={13} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export type CanvasMenuItem = {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * 画布右键菜单。坐标是舞台内屏幕坐标；点外、Esc 或选中一项后关闭。
 */
export function CanvasMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CanvasMenuItem[];
  onClose: () => void;
}) {
  return (
    <div
      className="canvas-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={item.danger ? 'is-danger' : undefined}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 多选时的批量操作条，浮在舞台底部中央。
 */
export function CanvasMultiBar({
  count,
  confirming,
  suspending,
  onConfirm,
  onSuspend,
  onResume,
  onArchive,
  onClear,
}: {
  count: number;
  confirming: boolean;
  suspending: boolean;
  onConfirm: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onArchive: () => void;
  onClear: () => void;
}) {
  return (
    <div className="canvas-multi-bar" role="toolbar" aria-label="批量操作">
      <span className="canvas-multi-count">已选 {count} 项</span>
      {confirming ? (
        <button type="button" onClick={onConfirm}>
          <CheckCheck width={13} height={13} strokeWidth={1.8} />
          确认
        </button>
      ) : null}
      {suspending ? (
        <>
          <button type="button" onClick={onSuspend}>
            <Pause width={13} height={13} strokeWidth={1.8} />
            不复习
          </button>
          <button type="button" onClick={onResume}>
            <Play width={13} height={13} strokeWidth={1.8} />
            恢复
          </button>
        </>
      ) : null}
      <button type="button" className="is-danger" onClick={onArchive}>
        <Trash2 width={13} height={13} strokeWidth={1.8} />
        归档
      </button>
      <button type="button" aria-label="取消选择" onClick={onClear}>
        <X width={13} height={13} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function revisionWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (Date.now() - date.getTime() < 60_000) return '刚刚';
  return formatDateTime(iso);
}

/** 脑图版本列表。恢复会另记一版，所以还能再回到恢复前。 */
export function CanvasRevisionList({
  revisions,
  loading,
  restoringId,
  onRestore,
  onClose,
}: {
  revisions: CanvasRevision[];
  loading: boolean;
  restoringId: string | null;
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-canvas-history-toggle]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="canvas-history"
      role="dialog"
      aria-label="脑图编辑历史"
    >
      <div className="canvas-history-head">
        <strong>编辑历史</strong>
        <span>最近 40 版</span>
      </div>
      {loading && revisions.length === 0 ? (
        <p className="canvas-history-empty">正在读取…</p>
      ) : revisions.length === 0 ? (
        <p className="canvas-history-empty">还没有记录。改动脑图后会记在这里。</p>
      ) : (
        <ul>
          {revisions.map((revision) => (
            <li key={revision.id} className="canvas-history-row">
              <div>
                <time dateTime={revision.createdAt}>{revisionWhen(revision.createdAt)}</time>
                <p>{revision.summary}</p>
              </div>
              {revision.current ? (
                <span className="canvas-history-current">当前</span>
              ) : (
                <button
                  type="button"
                  disabled={restoringId !== null}
                  onClick={() => onRestore(revision.id)}
                >
                  {restoringId === revision.id ? '恢复中' : '恢复'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const HELP_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: '节点',
    rows: [
      ['单击', '选中；再点不取消'],
      ['空格 / 双击', '编辑'],
      ['Tab', '加子节点'],
      ['Enter', '加兄弟节点'],
      ['Shift+单击', '加选 / 减选'],
      ['⌘A', '全选'],
      ['Delete', '删除（卡片、批注进回收站）'],
    ],
  },
  {
    title: '结构',
    rows: [
      ['拖拽', '换父级 / 排序 / 独立成树'],
      ['⌘] / ⌘[', '缩进 / 提升'],
      ['⌥↑ / ⌥↓', '同级里移动'],
      ['← / →', '折叠 / 展开，父子跳转'],
      ['⌘Z / ⌘Y', '撤销 / 重做'],
      ['编辑历史', '恢复之前的结构'],
    ],
  },
  {
    title: '画布',
    rows: [
      ['拖空白 / 中键拖', '平移'],
      ['Shift+拖空白', '框选'],
      ['滚轮 / 捏合', '平移 / 缩放'],
      ['双击空白', '新建文本节点'],
      ['⌘F', '画布内搜索'],
      ['⌘0 / ⌘±', '适配 / 缩放'],
      ['M', '默写：遮住内容看结构'],
      ['右键', '节点与画布菜单'],
      ['?', '这张速查表'],
    ],
  },
];

export function CanvasHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="canvas-help" role="dialog" aria-label="快捷键">
      <div className="canvas-help-head">
        <span>脑图快捷键</span>
        <button type="button" aria-label="关闭" onClick={onClose}>
          <X width={13} height={13} strokeWidth={1.8} />
        </button>
      </div>
      <div className="canvas-help-body">
        {HELP_SECTIONS.map((section) => (
          <div key={section.title} className="canvas-help-sec">
            <p className="canvas-help-title">{section.title}</p>
            {section.rows.map(([keys, label]) => (
              <p key={keys} className="canvas-help-row">
                <kbd>{keys}</kbd>
                <span>{label}</span>
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
