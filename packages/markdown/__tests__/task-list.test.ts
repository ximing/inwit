import { describe, expect, it } from 'vitest';
import {
  parseMarkdownToPmJSON,
  serializePmJSONToMarkdown,
} from '../src/pipeline.js';
import type { PmNode } from '../src/index.js';

function collect(node: PmNode, type: string, acc: PmNode[] = []): PmNode[] {
  if (node.type === type) acc.push(node);
  for (const child of node.content ?? []) collect(child, type, acc);
  return acc;
}

function roundTripPm(md: string): string {
  const first = serializePmJSONToMarkdown(parseMarkdownToPmJSON(md));
  return serializePmJSONToMarkdown(parseMarkdownToPmJSON(first));
}

const TASK_MD = '- [x] a\n- [ ] b\n';

describe('GFM task list', () => {
  it('parses checked and unchecked items into taskList / taskItem', () => {
    const pm = parseMarkdownToPmJSON(TASK_MD);
    expect(collect(pm, 'bulletList')).toEqual([]);
    expect(collect(pm, 'listItem')).toEqual([]);
    const lists = collect(pm, 'taskList');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.content).toEqual([
      {
        type: 'taskItem',
        attrs: { checked: true },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
      },
      {
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
      },
    ]);
  });

  it('serializes taskList back to - [x] / - [ ]', () => {
    expect(serializePmJSONToMarkdown(parseMarkdownToPmJSON(TASK_MD))).toBe(TASK_MD);
    expect(
      serializePmJSONToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
              },
            ],
          },
        ],
      }),
    ).toBe(TASK_MD);
  });

  it('is idempotent through PM twice', () => {
    expect(roundTripPm(TASK_MD)).toBe(TASK_MD);
  });

  it('leaves lists without checkboxes as bulletList / orderedList', () => {
    const bullets = parseMarkdownToPmJSON('- a\n- b\n');
    expect(collect(bullets, 'taskList')).toEqual([]);
    expect(collect(bullets, 'bulletList')).toHaveLength(1);
    expect(collect(bullets, 'listItem')).toHaveLength(2);

    const ordered = parseMarkdownToPmJSON('1. a\n2. b\n');
    expect(collect(ordered, 'taskList')).toEqual([]);
    expect(collect(ordered, 'orderedList')).toHaveLength(1);
  });

  it('promotes a mixed list (checkbox + plain item) to taskList', () => {
    const pm = parseMarkdownToPmJSON('- [x] a\n- b\n');
    expect(collect(pm, 'taskList')).toHaveLength(1);
    expect(collect(pm, 'bulletList')).toEqual([]);
    const items = collect(pm, 'taskItem');
    expect(items.map((item) => item.attrs?.checked)).toEqual([true, false]);
    expect(serializePmJSONToMarkdown(pm)).toBe('- [x] a\n- [ ] b\n');
  });
});
