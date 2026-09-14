import Placeholder from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, type MouseEvent } from 'react';
import { Markdown } from 'tiptap-markdown';

const NEW_DOC_JSON = {
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }],
};

function toMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? '';
}

type PaperEditorProps = {
  seedKey: string;
  seedMarkdown: string | null;
  onChange: (markdown: string) => void;
  onSave: () => void;
};

export function PaperEditor({ seedKey, seedMarkdown, onChange, onSave }: PaperEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading' && node.attrs.level === 1) return '标题';
          return '这张纸还是空的，写点什么吧';
        },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
    ],
    content: seedMarkdown ?? NEW_DOC_JSON,
    editorProps: {
      attributes: {
        class: 'paper-body',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(toMarkdown(instance));
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (seedMarkdown === null) {
      editor.commands.setContent(NEW_DOC_JSON, { emitUpdate: false });
      return;
    }
    editor.commands.setContent(seedMarkdown, { emitUpdate: false });
  }, [editor, seedKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!editor) {
    return <div className="paper" />;
  }

  const run = (fn: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    fn();
  };

  return (
    <div className="paper">
      <BubbleMenu editor={editor} className="bubble-menu">
        <button
          type="button"
          className={editor.isActive('bold') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleBold().run())}
        >
          粗
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleItalic().run())}
        >
          斜
        </button>
        <button
          type="button"
          className={editor.isActive('heading', { level: 1 }) ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        >
          H1
        </button>
        <button
          type="button"
          className={editor.isActive('heading', { level: 2 }) ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        >
          H2
        </button>
        <button
          type="button"
          className={editor.isActive('bulletList') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleBulletList().run())}
        >
          列表
        </button>
        <button
          type="button"
          className={editor.isActive('orderedList') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleOrderedList().run())}
        >
          编号
        </button>
        <button
          type="button"
          className={editor.isActive('blockquote') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleBlockquote().run())}
        >
          引用
        </button>
        <button
          type="button"
          className={editor.isActive('codeBlock') ? 'is-on' : undefined}
          onMouseDown={run(() => editor.chain().focus().toggleCodeBlock().run())}
        >
          代码
        </button>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
