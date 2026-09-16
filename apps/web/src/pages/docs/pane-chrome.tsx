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

export const PaneChrome = observer(function PaneChrome({
  editing,
  docId,
  hideModeSwitch = false,
}: {
  editing: boolean;
  docId: string | null;
  hideModeSwitch?: boolean;
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

  return (
    <div className="pane-chrome">
      <button type="button" className="btn btn-ghost" onClick={close}>
        <X width={14} height={14} strokeWidth={1.8} />
        关闭
      </button>
      <TopicPicker
        topics={service.topics}
        topicId={topicId}
        open={service.paneTopicMenuOpen}
        compact
        onToggle={() => service.togglePaneTopicMenu()}
        onSelect={(id) => {
          if (editing) editor.setTopicId(id);
          const documentId = editor.id ?? service.doc?.id ?? docId;
          if (documentId) void service.setDocTopic(id, documentId);
        }}
        onNew={() => service.openNewTopic('pane')}
      />
      {editing && editor.saveLabel ? (
        <span className={`save-state is-${editor.saveState}`}>
          {editor.saveState === 'saved' ? <span className="ok">●</span> : null}
          {editor.saveLabel}
        </span>
      ) : null}
      <span className="spacer" />
      {hideModeSwitch ? null : <ModeSwitch />}
    </div>
  );
});
