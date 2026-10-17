import { observer, useService } from '@rabjs/react';
import { Columns2, Loader2, Rows2, Sparkles } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { DocsService } from '@/pages/docs/docs.service.js';
import { CardRail } from '@/pages/docs/card-rail';
import {
  CANVAS_PANE_WIDTH_DEFAULT,
  CARD_RAIL_WIDTH_DEFAULT,
  cardRailLimits,
  cardRailWidthFromDrag,
  cardRailWidthFromKey,
  clampCardRailWidth,
} from '@/services/ui-prefs-logic.js';
import { UiPrefsService } from '@/services/ui-prefs.service.js';
import { ConceptsPanel } from '../concepts/concepts-panel.js';
import { ConceptsService } from '../concepts/concepts.service.js';
import { dockRatioFromDrag } from './study-layout.js';
import { shortcutBlockedTarget, studyModeFromKey } from './study-mode-hotkey.js';
import { StudyWorkspaceService } from './study-workspace.service.js';
import { StudyLinkService } from './study-link.service.js';

/**
 * 学习区 dock：脑图与概念区的承载容器（T7/T8/T8a）。
 * outline = 仅脑图（现状）；concepts = 仅概念区；compare = 双视图对照。
 */
export const StudyDock = observer(function StudyDock() {
  const docs = useService(DocsService);
  const prefs = useService(UiPrefsService);
  const workspace = useService(StudyWorkspaceService);
  const concepts = useService(ConceptsService);
  const link = useService(StudyLinkService);
  const [params] = useSearchParams();
  const batchParam = params.get('conceptBatch');
  const docId = docs.doc?.id ?? null;
  const topicId = docs.doc?.topicId ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stopSepDrag = useRef<(() => void) | null>(null);
  const stopWidthDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopSepDrag.current?.();
      stopWidthDrag.current?.();
      document.documentElement.classList.remove('is-resizing-card-rail');
    };
  }, []);

  // 工作区与概念域按 文章+主题 启动；切文章不串状态
  useEffect(() => {
    if (!docId || !topicId) return;
    const scopeId = `${docId}:${topicId}`;
    workspace.boot(scopeId);
    void concepts.boot(topicId, docId);
  }, [docId, topicId, workspace, concepts]);

  // 容器尺寸（含高度）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      // 布局阈值按整个文章工作区（父容器）判断，不是学习区 dock 本身
      const host = el.closest('.pane-doc') ?? el.parentElement ?? el;
      const rect = host.getBoundingClientRect();
      workspace.setContainer(rect.width, rect.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [workspace]);

  // 对话动作卡 / 外部入口：?conceptBatch=<id> 打开候选
  const conceptsEnabled = concepts.enabled;
  useEffect(() => {
    if (!batchParam || !conceptsEnabled) return;
    void concepts.loadBatch(batchParam);
    workspace.setMode('concepts');
  }, [batchParam, conceptsEnabled, concepts, workspace]);

  // 1 结构、2 概念、3 对照。编辑器和对话框里不抢按键。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!topicId || (concepts.probed && !concepts.enabled)) return;
      if (shortcutBlockedTarget(event.target)) return;
      const mode = studyModeFromKey(event);
      if (!mode) return;
      event.preventDefault();
      workspace.setMode(mode);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topicId, concepts.probed, concepts.enabled, workspace]);

  // 脑图卡片选择 → 概念高亮（联动只高亮）
  const activeCardId = docs.activeCardId;
  useEffect(() => {
    void link.onCardSelected(activeCardId);
  }, [activeCardId, link]);

  if (!topicId) return <CardRail />;
  if (concepts.probed && !concepts.enabled) return <CardRail />;

  const effective = workspace.effective;
  const showOutline = workspace.showOutline;
  const showConcepts = workspace.showConcepts;
  const compare = effective.mode === 'compare' && !workspace.layout.zoomedPane;
  const wide = prefs.cardLayout === 'map' || prefs.zenMode;
  const dockWidth = clampCardRailWidth(
    wide ? prefs.canvasPaneWidth : prefs.cardRailWidth,
    docs.paneWidth,
    wide,
  );
  const limits = cardRailLimits(wide, docs.paneWidth);
  const splitStyle = compare
    ? { flexGrow: workspace.layout.dockRatio, flexBasis: 0 }
    : undefined;

  const applyDockWidth = (width: number) => {
    if (wide) prefs.setCanvasPaneWidth(width, docs.paneWidth);
    else prefs.setCardRailWidth(width, docs.paneWidth);
  };

  const onWidthPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopWidthDrag.current?.();
    const startX = event.clientX;
    const startWidth = dockWidth;
    document.documentElement.classList.add('is-resizing-card-rail');
    const onMove = (move: globalThis.PointerEvent) => {
      applyDockWidth(cardRailWidthFromDrag(startWidth, startX, move.clientX));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.documentElement.classList.remove('is-resizing-card-rail');
      if (stopWidthDrag.current === onUp) stopWidthDrag.current = null;
    };
    stopWidthDrag.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onSepPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopSepDrag.current?.();
    const host = bodyRef.current;
    if (!host) return;
    const columns = effective.arrangement === 'columns';
    const rect = host.getBoundingClientRect();
    const size = columns ? rect.width : rect.height;
    const start = columns ? event.clientX : event.clientY;
    const startRatio = workspace.layout.dockRatio;
    const onMove = (move: globalThis.PointerEvent) => {
      const current = columns ? move.clientX : move.clientY;
      workspace.setDockRatio(dockRatioFromDrag(startRatio, start, current, size));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (stopSepDrag.current === onUp) stopSepDrag.current = null;
    };
    stopSepDrag.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className={`study-dock${compare ? ' is-compare' : ''}${workspace.layout.zoomedPane ? ' is-zoomed' : ''}`}
      ref={rootRef}
      style={{ '--card-rail-width': `${dockWidth}px` } as CSSProperties}
    >
      <div
        className="card-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整学习区宽度"
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={dockWidth}
        tabIndex={0}
        onPointerDown={onWidthPointerDown}
        onDoubleClick={() => applyDockWidth(wide ? CANVAS_PANE_WIDTH_DEFAULT : CARD_RAIL_WIDTH_DEFAULT)}
        onKeyDown={(event) => {
          const next = cardRailWidthFromKey(dockWidth, event.key, 16, limits);
          if (next == null) return;
          event.preventDefault();
          applyDockWidth(next);
        }}
      />
      <div className="study-dock-tabs" role="tablist" aria-label="学习区视图">
        <button
          type="button"
          role="tab"
          aria-selected={workspace.layout.preferredMode === 'outline'}
          className={workspace.layout.preferredMode === 'outline' ? 'is-active' : ''}
          aria-keyshortcuts="1"
          onClick={() => workspace.setMode('outline')}
        >
          结构
          <kbd>1</kbd>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspace.layout.preferredMode === 'concepts'}
          className={workspace.layout.preferredMode === 'concepts' ? 'is-active' : ''}
          aria-keyshortcuts="2"
          onClick={() => workspace.setMode('concepts')}
        >
          概念
          <kbd>2</kbd>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspace.layout.preferredMode === 'compare'}
          className={workspace.layout.preferredMode === 'compare' ? 'is-active' : ''}
          aria-keyshortcuts="3"
          onClick={() => workspace.setMode('compare')}
        >
          对照
          <kbd>3</kbd>
        </button>
        <span className="study-dock-gap" />
        {compare ? (
          <button type="button" className="study-dock-arrange" onClick={() => workspace.toggleArrangement()} aria-label="切换排列">
            {workspace.layout.arrangement === 'columns' ? (
              <Rows2 width={13} height={13} strokeWidth={1.8} />
            ) : (
              <Columns2 width={13} height={13} strokeWidth={1.8} />
            )}
          </button>
        ) : null}
        {concepts.writable ? (
          <button
            type="button"
            className="study-dock-generate"
            disabled={concepts.batchPhase === 'generating'}
            onClick={() => {
              workspace.setMode('concepts');
              void concepts.startGeneration('document');
            }}
          >
            {concepts.batchPhase === 'generating' ? (
              <Loader2 className="icon-spin" width={13} height={13} strokeWidth={1.8} />
            ) : (
              <Sparkles width={13} height={13} strokeWidth={1.8} />
            )}
            生成概念与关系
          </button>
        ) : null}
      </div>

      <div className="study-dock-body" data-arrangement={effective.arrangement} ref={bodyRef}>
        {showOutline ? (
          <div
            className="study-dock-pane is-outline"
            style={splitStyle}
            onPointerDown={() => workspace.markFocus('outline')}
          >
            <CardRail />
            {compare ? (
              <button type="button" className="study-dock-zoom" onClick={() => workspace.zoomPane('outline')}>
                放大脑图
              </button>
            ) : null}
          </div>
        ) : null}
        {compare ? (
          <div
            className="study-dock-sep"
            role="separator"
            aria-orientation={effective.arrangement === 'columns' ? 'vertical' : 'horizontal'}
            aria-label="调整对照比例"
            tabIndex={0}
            onPointerDown={onSepPointerDown}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                workspace.setDockRatio(workspace.layout.dockRatio - 0.05);
                event.preventDefault();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                workspace.setDockRatio(workspace.layout.dockRatio + 0.05);
                event.preventDefault();
              }
            }}
          />
        ) : null}
        {showConcepts ? (
          <div
            className="study-dock-pane is-concepts"
            style={compare ? { flexGrow: 1 - workspace.layout.dockRatio, flexBasis: 0 } : undefined}
            onPointerDown={() => workspace.markFocus('concepts')}
          >
            <ConceptsPanel />
            {compare ? (
              <button type="button" className="study-dock-zoom" onClick={() => workspace.zoomPane('concepts')}>
                放大概念区
              </button>
            ) : null}
          </div>
        ) : null}
        {workspace.layout.zoomedPane ? (
          <button type="button" className="study-dock-unzoom" onClick={() => workspace.zoomPane(null)}>
            恢复布局
          </button>
        ) : null}
      </div>
    </div>
  );
});
