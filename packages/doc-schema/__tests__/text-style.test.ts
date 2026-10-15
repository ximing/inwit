import { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { getHeadlessSchema } from '../src/schema/headless.js';

describe('textStyle mark', () => {
  it('keeps color, font size, and background together', () => {
    const schema = getHeadlessSchema();
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '彩色',
              marks: [
                {
                  type: 'textStyle',
                  attrs: {
                    color: '#b3402a',
                    fontSize: '18px',
                    backgroundColor: '#f6e7a8',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const pm = Node.fromJSON(schema, json);
    const mark = pm.firstChild?.firstChild?.marks[0];
    expect(mark?.type.name).toBe('textStyle');
    expect(mark?.attrs).toEqual({
      color: '#b3402a',
      fontSize: '18px',
      backgroundColor: '#f6e7a8',
    });
    const saved = pm.toJSON() as {
      content: { content: { marks: { type: string; attrs: Record<string, unknown> }[] }[] }[];
    };
    expect(saved.content[0]?.content[0]?.marks[0]).toEqual({
      type: 'textStyle',
      attrs: {
        color: '#b3402a',
        fontSize: '18px',
        backgroundColor: '#f6e7a8',
      },
    });
  });
});
