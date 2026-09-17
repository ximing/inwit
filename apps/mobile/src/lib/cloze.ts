export type ClozePart =
  | { type: 'text'; value: string }
  | { type: 'cloze'; value: string };

/** Anki-style `{{cN::text}}` / `{{cN::text::hint}}`. */
const CLOZE_RE = /\{\{c\d+::((?:(?!\}\}).)*)\}\}/gu;

export const CLOZE_MASK = '……';

export function parseCloze(source: string): ClozePart[] {
  const parts: ClozePart[] = [];
  let last = 0;
  const re = new RegExp(CLOZE_RE.source, CLOZE_RE.flags);
  for (const match of source.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ type: 'text', value: source.slice(last, start) });
    }
    const inner = match[1] ?? '';
    const sep = inner.indexOf('::');
    const value = sep === -1 ? inner : inner.slice(0, sep);
    parts.push({ type: 'cloze', value });
    last = start + match[0].length;
  }
  if (last < source.length) {
    parts.push({ type: 'text', value: source.slice(last) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', value: source });
  }
  return parts;
}

/** Reveal cloze answers and drop the `{{cN::}}` markers. */
export function stripCloze(source: string): string {
  return parseCloze(source)
    .map((part) => part.value)
    .join('');
}

/** Replace cloze answers with a placeholder (review front). */
export function maskCloze(source: string, placeholder = CLOZE_MASK): string {
  return parseCloze(source)
    .map((part) => (part.type === 'cloze' ? placeholder : part.value))
    .join('');
}
