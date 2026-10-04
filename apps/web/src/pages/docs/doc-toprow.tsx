import { observer, useService } from '@rabjs/react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Tip } from '@/components/tip';
import { formatRelativeTime } from '@/lib/format';
import { documentReturnTarget } from '@/routes';
import { UiPrefsService, type DocMode } from '@/services/ui-prefs.service';
import { DocsService } from './docs.service';
import { EditorService } from './editor.service';
import { TopicPicker } from './topic-picker';

const ModeSwitch = observer(function ModeSwitch() {
  const prefs = useService(UiPrefsService);
  const options: ReadonlyArray<{ id: DocMode; label: string }> = [
    { id: 'edit', label: '编辑' },
    { id: 'preview', label: '预览' },
  ];
  return (
    <div className="mode-seg" role="radiogroup" aria-label="编辑或预览">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={prefs.docMode === option.id}
          className={`mode-seg-btn${prefs.docMode === option.id ? ' is-on' : ''}`}
          onClick={() => prefs.setDocMode(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
});

/**
 * 文档题区顶行：左侧主题 kicker，右侧弱视觉工具丸（保存状态 / 模式切换 / 关闭）。
 * 默认 inline 形态放在 .pane-inner 内与正文列对齐；PDF 等无正文列的场景用 bar 形态置顶。
 */
export const DocTopRow = observer(function DocTopRow({
  editing,
  docId,
  hideModeSwitch = false,
  layout = 'inline',
}: {
  editing: boolean;
  docId: string | null;
  hideModeSwitch?: boolean;
  layout?: 'inline' | 'bar';
}) {
  const service = useService(DocsService);
  const editor = useService(EditorService);
  const prefs = useService(UiPrefsService);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const returnTo = documentReturnTarget(location.pathname, params);
  const backToTopic = returnTo.path.startsWith('/topics');
  const topicId = editing
    ? (editor.topicId ?? service.doc?.topicId ?? null)
    : (service.doc?.topicId ?? null);

  const close = () => {
    service.endComposeNew();
    navigate(returnTo.path, returnTo.replace ? { replace: true } : undefined);
  };

  const showSave = editing && Boolean(editor.saveLabel);
  const showMode = !hideModeSwitch;
  // 预览态把更新时间放在工具丸里（原标题下 meta 的位置）；编辑态这个位置是保存状态
  const timeDoc = !editing && service.doc && service.doc.id === docId ? service.doc : null;

  return (
    <div className={`doc-toprow${layout === 'bar' ? ' is-bar' : ''}`}>
      <TopicPicker
        topics={service.topics}
        topicId={topicId}
        open={service.paneTopicMenuOpen}
        kicker
        onToggle={() => service.togglePaneTopicMenu()}
        onSelect={(id) => {
          if (editing) editor.setTopicId(id);
          const documentId = editor.id ?? service.doc?.id ?? docId;
          if (documentId) void service.setDocTopic(id, documentId);
        }}
        onNew={() => service.openNewTopic('pane')}
      />
      <span className="spacer" />
      <div className="doc-fab">
        {showSave ? (
          <>
            <span className={`save-state is-${editor.saveState}`}>
              {editor.saveState === 'saved' ? <span className="ok">●</span> : null}
              {editor.saveLabel}
            </span>
            {showMode ? <span className="divider" /> : null}
          </>
        ) : null}
        {timeDoc ? (
          <>
            <span className="doc-toprow-time">{formatRelativeTime(timeDoc.updatedAt)}</span>
            {showMode ? <span className="divider" /> : null}
          </>
        ) : null}
        {showMode ? <ModeSwitch /> : null}
        <span className="divider" />
        <Tip content={prefs.zenMode ? '退出禅模式' : '进入禅模式'}>
        <button
          type="button"
          className={`doc-fab-zen${prefs.zenMode ? ' is-on' : ''}`}
          aria-pressed={prefs.zenMode}
          aria-label={prefs.zenMode ? '退出禅模式' : '进入禅模式'}
          onClick={() => prefs.setZenMode(!prefs.zenMode)}
        >
          {prefs.zenMode ? (
            <Minimize2 width={13} height={13} strokeWidth={1.8} />
          ) : (
            <Maximize2 width={13} height={13} strokeWidth={1.8} />
          )}
        </button>
        </Tip>
        <Tip content={backToTopic ? '返回主题' : '关闭'}>
        <button
          type="button"
          className="doc-fab-close"
          onClick={close}
          aria-label={backToTopic ? '返回主题' : '关闭'}
        >
          <X width={13} height={13} strokeWidth={1.8} />
        </button>
        </Tip>
      </div>
    </div>
  );
});
