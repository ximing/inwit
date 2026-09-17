import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { isModEnterHotkey } from '@/lib/format';

/** 页面 service 用来在发送时读取/清空编辑器内容。 */
export type CaptureEditorHandle = {
  getJSON: () => unknown;
  getText: () => string;
  clear: () => void;
  focus: () => void;
};

/**
 * 「扔进去」捕获框的富文本编辑器：轻量 tiptap（无图片/表格/代码块），
 * 粘贴保留格式；Mod+Enter 触发 onSubmit。
 */
export function CaptureEditor({
  placeholder,
  disabled = false,
  onTextChange,
  onSubmit,
  onReady,
}: {
  placeholder: string;
  disabled?: boolean;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onReady: (handle: CaptureEditorHandle | null) => void;
}) {
  const onTextChangeRef = useRef(onTextChange);
  const onSubmitRef = useRef(onSubmit);
  const onReadyRef = useRef(onReady);
  onTextChangeRef.current = onTextChange;
  onSubmitRef.current = onSubmit;
  onReadyRef.current = onReady;

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true },
      }),
      TaskList,
      TaskItem,
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: { class: 'capture-editor-body' },
      handleKeyDown: (_view, event) => {
        if (isModEnterHotkey(event)) {
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      onTextChangeRef.current(instance.getText());
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) {
      onReadyRef.current(null);
      return;
    }
    onReadyRef.current({
      getJSON: () => editor.getJSON(),
      getText: () => editor.getText(),
      clear: () => editor.commands.clearContent(true),
      focus: () => editor.commands.focus(),
    });
    return () => onReadyRef.current(null);
  }, [editor]);

  return (
    <div className={`capture-editor${disabled ? ' is-disabled' : ''}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
