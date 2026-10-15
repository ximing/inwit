import type { AnyExtension } from '@tiptap/core';
import { BackgroundColor, Color, FontSize, TextStyle } from '@tiptap/extension-text-style';

/**
 * Color, size, and background share one `textStyle` mark.
 * Link's priority is 1000, so this span stays inside the anchor and an
 * explicit color is not covered by the accent link color.
 */
export function createDocTextStyleExtensions(): AnyExtension[] {
  return [TextStyle, Color, FontSize, BackgroundColor];
}
