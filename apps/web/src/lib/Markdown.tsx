/** Timeline answers longer than this get a collapsed preview +「展开全文」. */
export const ANSWER_FOLD_CHARS = 300;

export function shouldFoldAnswer(text: string): boolean {
  return Array.from(text).length > ANSWER_FOLD_CHARS;
}
