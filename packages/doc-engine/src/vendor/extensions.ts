import { AnnotationMark, CardAnchorMark, PageBreak, VitalEntity } from '@inwit/doc-schema';
import { mergeAttributes, Node, type AnyExtension, type NodeViewRendererProps } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import type { AssetUrlProvider } from '../asset-map';

const lowlight = createLowlight(common);

const DEFAULT_PLACEHOLDER = '开始书写…';

export type CreateDocExtensionsOpts = {
  editable: boolean;
  placeholder?: string;
  assetUrls: AssetUrlProvider;
  anchorHighlight?: AnyExtension;
};

function attrString(node: ProseMirrorNode, key: string): string {
  const value = node.attrs[key];
  return typeof value === 'string' ? value : '';
}

function createUploadedImage(assetUrls: AssetUrlProvider) {
  return Image.extend({
    addNodeView() {
      return ({ node }: NodeViewRendererProps): NodeView => {
        let current = node;
        const img = document.createElement('img');
        img.className = 'doc-image';

        const sync = (): void => {
          const src = attrString(current, 'src');
          const alt = attrString(current, 'alt');
          const title = attrString(current, 'title');
          if (alt) img.alt = alt;
          else img.removeAttribute('alt');
          if (title) img.title = title;
          else img.removeAttribute('title');

          const url = assetUrls.urlFor(src);
          if (url) {
            img.src = url;
            img.classList.remove('doc-image-pending');
          } else {
            img.removeAttribute('src');
            img.classList.add('doc-image-pending');
          }
          if (src) void assetUrls.ensure([src]);
        };

        const unsub = assetUrls.subscribe(sync);
        sync();
        return {
          dom: img,
          update: (updated: ProseMirrorNode) => {
            if (updated.type !== current.type) return false;
            current = updated;
            sync();
            return true;
          },
          destroy: () => {
            unsub();
          },
          ignoreMutation: () => true,
        };
      };
    },
  }).configure({
    inline: true,
    allowBase64: false,
  });
}

function createVideoNode(assetUrls: AssetUrlProvider) {
  return Node.create({
    name: 'video',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        src: { default: null },
        poster: { default: null },
        mime: {
          default: null,
          parseHTML: (element) => element.getAttribute('type') || element.getAttribute('data-mime'),
          renderHTML: (attributes) => (attributes.mime ? { type: attributes.mime } : {}),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'video[src]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['video', mergeAttributes({ controls: '', playsinline: '' }, HTMLAttributes)];
    },

    addNodeView() {
      return ({ node }: NodeViewRendererProps): NodeView => {
        let current = node;
        const wrapper = document.createElement('div');
        wrapper.className = 'doc-video';

        const pending = document.createElement('div');
        pending.className = 'doc-video-pending';

        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('controls', '');

        const fallback = document.createElement('a');
        fallback.className = 'doc-video-fallback';
        fallback.rel = 'noopener noreferrer';
        fallback.target = '_blank';
        fallback.textContent = '下载视频';

        wrapper.append(pending, video, fallback);

        const setState = (state: 'pending' | 'ready' | 'failed'): void => {
          pending.hidden = state !== 'pending';
          video.hidden = state !== 'ready';
          fallback.hidden = state !== 'failed';
          wrapper.classList.toggle('doc-video-pending', state === 'pending');
          wrapper.classList.toggle('doc-video-failed', state === 'failed');
        };

        const onError = (): void => {
          if (!video.getAttribute('src')) return;
          const href = video.currentSrc || video.src;
          if (href) fallback.href = href;
          setState('failed');
        };
        video.addEventListener('error', onError);

        const sync = (): void => {
          const src = attrString(current, 'src');
          const poster = attrString(current, 'poster');
          const url = assetUrls.urlFor(src);
          const posterUrl = poster ? assetUrls.urlFor(poster) : null;
          if (posterUrl) video.setAttribute('poster', posterUrl);
          else video.removeAttribute('poster');

          if (!url) {
            if (video.hasAttribute('src')) video.removeAttribute('src');
            fallback.removeAttribute('href');
            setState('pending');
          } else {
            if (video.getAttribute('src') !== url) video.src = url;
            setState('ready');
          }

          const toEnsure = [src, poster].filter((value) => value.length > 0);
          if (toEnsure.length > 0) void assetUrls.ensure(toEnsure);
        };

        const unsub = assetUrls.subscribe(sync);
        sync();
        return {
          dom: wrapper,
          update: (updated: ProseMirrorNode) => {
            if (updated.type !== current.type) return false;
            current = updated;
            sync();
            return true;
          },
          destroy: () => {
            video.removeEventListener('error', onError);
            unsub();
          },
          ignoreMutation: () => true,
        };
      };
    },
  });
}

export function createDocExtensions(opts: CreateDocExtensionsOpts): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    createUploadedImage(opts.assetUrls),
    createVideoNode(opts.assetUrls),
    TaskList,
    TaskItem.configure({ nested: true }),
    Subscript,
    Superscript,
    VitalEntity,
    PageBreak,
    AnnotationMark,
    CardAnchorMark,
  ];
  if (opts.editable) {
    extensions.push(
      Placeholder.configure({
        placeholder: opts.placeholder ?? DEFAULT_PLACEHOLDER,
      }),
    );
  }
  if (opts.anchorHighlight) extensions.push(opts.anchorHighlight);
  return extensions;
}
