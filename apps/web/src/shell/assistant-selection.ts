import { CONVERSATION_SELECTION_QUOTE_MAX, type ConversationSelection } from '@inwit/dto';

function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

/** Selection captured from the article, ready to store on a conversation turn. */
export function highlightSelection(input: {
  documentId: string;
  quote: string;
  blockIndex?: number;
  from?: number;
  to?: number;
  pageIndex?: number;
}): ConversationSelection {
  const hasRange = input.from != null && input.to != null && input.to > input.from;
  return {
    documentId: input.documentId,
    quote: clip(input.quote, CONVERSATION_SELECTION_QUOTE_MAX),
    ...(input.blockIndex != null && input.blockIndex >= 1 ? { blockIndex: input.blockIndex } : {}),
    ...(hasRange ? { from: input.from, to: input.to } : {}),
    ...(input.pageIndex != null && input.pageIndex >= 0 ? { pageIndex: input.pageIndex } : {}),
  };
}

/** Page is shown 1-based. Character offsets stay in the model prompt. */
export function highlightPlaceLabel(selection: {
  blockIndex?: number | undefined;
  pageIndex?: number | undefined;
}): string {
  const parts: string[] = [];
  if (selection.pageIndex != null) parts.push(`第 ${String(selection.pageIndex + 1)} 页`);
  if (selection.blockIndex != null) parts.push(`第 ${String(selection.blockIndex)} 块`);
  return parts.length > 0 ? parts.join(' · ') : '划线';
}
