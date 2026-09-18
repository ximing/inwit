import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/routes';
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
  const navigate = useNavigate();
  const topicId = editing
    ? (editor.topicId ?? service.doc?.topicId ?? null)
    : (service.doc?.topicId ?? null);

  const close = () => {
    service.endComposeNew();
    navigate(ROUTES.docs);
  };

  const showSave = editing && Boolean(editor.saveLabel);
  const showMode = !hideModeSwitch;

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
        {showMode ? <ModeSwitch /> : null}
        <span className="divider" />
        <button type="button" className="doc-fab-close" onClick={close} title="关闭" aria-label="关闭">
          <X width={13} height={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
});
