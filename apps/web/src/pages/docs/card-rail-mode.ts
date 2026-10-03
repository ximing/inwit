/** How the document card rail is presented. */
export type CardRailMode = 'hidden' | 'dock' | 'overlay' | 'stack';

export type CardRailModeInput = {
  hosted: boolean;
  zen: boolean;
  /** Pane is too narrow to keep a column beside the document. */
  narrow: boolean;
  collapsed: boolean;
  /** User chose 浮层 while the rail is open. */
  float: boolean;
  /** An anchor or annotation asked to reveal the rail. */
  peek: boolean;
};

/**
 * Opening the rail uses the saved 并排/浮层 choice.
 * A narrow pane cannot hold a column, so it stays a floating layer.
 * Topic-hosted documents stay beside the body unless the user picks 浮层.
 */
export function cardRailMode(input: CardRailModeInput): CardRailMode {
  if (input.zen && input.narrow) return 'stack';

  const opened = !input.collapsed || input.zen;
  if (!opened && !input.peek) return 'hidden';
  if (input.float) return 'overlay';
  // Peeking a collapsed rail must not reflow the article, except on a topic document.
  if (!opened && input.peek) return input.hosted ? 'dock' : 'overlay';
  if (input.hosted || !input.narrow) return 'dock';
  return 'overlay';
}

export function cardRailCanDock(input: { hosted: boolean; narrow: boolean }): boolean {
  return input.hosted || !input.narrow;
}
