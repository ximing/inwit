import { describe, expect, it } from 'vitest';
import { buildAssociationHint } from './anchors.js';

describe('buildAssociationHint', () => {
  it('returns null when there are no concepts', () => {
    expect(buildAssociationHint([])).toBeNull();
    expect(buildAssociationHint(['  '])).toBeNull();
  });

  it('writes the PRD-style same_concept sentence', () => {
    expect(buildAssociationHint(['反向传播'])).toBe(
      '这和你学过的「反向传播」是一回事的两种说法。',
    );
    expect(buildAssociationHint(['反向传播', 'sigmoid', '反向传播'])).toBe(
      '这和你学过的「反向传播」、「sigmoid」是一回事的两种说法。',
    );
  });
});
