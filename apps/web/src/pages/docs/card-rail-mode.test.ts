import { describe, expect, it } from 'vitest';
import { cardRailCanDock, cardRailMode, type CardRailModeInput } from './card-rail-mode';

const hidden: CardRailModeInput = {
  hosted: false,
  zen: false,
  narrow: false,
  collapsed: true,
  float: false,
  peek: false,
};

describe('cardRailMode', () => {
  it('stays hidden until the rail is opened', () => {
    expect(cardRailMode(hidden)).toBe('hidden');
  });

  it('opens side by side by default', () => {
    expect(cardRailMode({ ...hidden, collapsed: false })).toBe('dock');
  });

  it('reopens into the saved floating choice', () => {
    expect(cardRailMode({ ...hidden, float: true })).toBe('hidden');
    expect(cardRailMode({ ...hidden, collapsed: false, float: true })).toBe('overlay');
  });

  it('cannot dock a narrow pane, so the open rail floats', () => {
    expect(cardRailMode({ ...hidden, collapsed: false, narrow: true })).toBe('overlay');
    expect(cardRailCanDock({ hosted: false, narrow: true })).toBe(false);
  });

  it('keeps a topic document beside the body, including a peek', () => {
    expect(cardRailMode({ ...hidden, hosted: true, collapsed: false, narrow: true })).toBe('dock');
    expect(cardRailMode({ ...hidden, hosted: true, peek: true })).toBe('dock');
    expect(cardRailMode({ ...hidden, hosted: true, collapsed: false, float: true })).toBe('overlay');
    expect(cardRailCanDock({ hosted: true, narrow: true })).toBe(true);
  });

  it('peeks a collapsed rail as a floating layer without docking the article', () => {
    expect(cardRailMode({ ...hidden, peek: true })).toBe('overlay');
  });

  it('stacks in narrow zen and docks in wide zen', () => {
    expect(cardRailMode({ ...hidden, zen: true, narrow: true })).toBe('stack');
    expect(cardRailMode({ ...hidden, zen: true })).toBe('dock');
  });
});
