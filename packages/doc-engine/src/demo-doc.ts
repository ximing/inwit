import type { PmDocJson } from '@inwit/dto';
import type { AnnotationAnchorInput, CardAnchorInput } from './protocol';

export const DEMO_CARD_ID = 'demo-card-1';
export const DEMO_NOTE_ID = 'demo-note-1';
export const DEMO_ASSET_SRC = 'asset:users/demo/pic.png';
export const DEMO_PICSUM_URL = 'https://picsum.photos/seed/inwit/800/480';

/** 全要素演示文档。段落 4 含 cardAnchor / annotationMark。 */
export const DEMO_DOC: PmDocJson = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '文档引擎演示' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '排版要素' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '段落与行内' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '间隔重复',
          marks: [{ type: 'cardAnchor', attrs: { cardIds: [DEMO_CARD_ID] } }],
        },
        { type: 'text', text: '是对抗' },
        {
          type: 'text',
          text: '遗忘曲线',
          marks: [{ type: 'annotationMark', attrs: { annotationId: DEMO_NOTE_ID } }],
        },
        { type: 'text', text: '的方法。正文可含' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: '与' },
        {
          type: 'text',
          text: '外部链接',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
        { type: 'text', text: '、' },
        {
          type: 'text',
          text: '内部路径',
          marks: [{ type: 'link', attrs: { href: '/docs/demo' } }],
        },
        { type: 'text', text: '。' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '列表' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序一项' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序二项' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序一项' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序二项' }] }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '已勾选任务' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '未勾选任务' }] }],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '表格' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            headerCell('概念'),
            headerCell('间隔'),
            headerCell('用途'),
          ],
        },
        {
          type: 'tableRow',
          content: [bodyCell('SM-2'), bodyCell('天级'), bodyCell('复习调度')],
        },
        {
          type: 'tableRow',
          content: [bodyCell('锚点'), bodyCell('字符级'), bodyCell('划选定位')],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '代码' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [
        {
          type: 'text',
          text: 'function greet(name) {\n  return `hello ${name}`;\n}',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '媒体' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'image',
          attrs: { src: DEMO_ASSET_SRC, alt: '演示图片' },
        },
      ],
    },
    { type: 'horizontalRule' },
    { type: 'pageBreak', attrs: { pageIndex: 1 } },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '分页之后的一段，用来确认 pageBreak 节点可见。' }],
    },
  ],
};

export const DEMO_CARDS: CardAnchorInput[] = [
  { id: DEMO_CARD_ID, anchorText: '间隔重复', anchorBlockIndex: 4 },
];

export const DEMO_ANNOTATIONS: AnnotationAnchorInput[] = [
  { id: DEMO_NOTE_ID, kind: 'text', quote: '遗忘曲线', anchorBlockIndex: 4 },
];

function headerCell(text: string) {
  return {
    type: 'tableHeader' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
  };
}

function bodyCell(text: string) {
  return {
    type: 'tableCell' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
  };
}
