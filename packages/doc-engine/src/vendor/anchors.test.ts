import { describe, expect, it } from 'vitest';
import { entitiesFromAnnotations } from './anchors';

describe('entitiesFromAnnotations', () => {
  it('keeps text and digest outline underlines, and skips pdf and note', () => {
    expect(
      entitiesFromAnnotations([
        { id: 'outline', kind: 'outline', note: '章' },
        { id: 'text', kind: 'text', note: '批' },
        { id: 'bare', note: '旧' },
        { id: 'pdf', kind: 'pdf', note: '框' },
        { id: 'note', kind: 'note', note: '想法' },
        { id: '', kind: 'outline', note: '空' },
      ]),
    ).toEqual([
      { id: 'outline', kind: 'annotation', outline: true, note: '章' },
      { id: 'text', kind: 'annotation', note: '批' },
      { id: 'bare', kind: 'annotation', note: '旧' },
    ]);
  });
});
