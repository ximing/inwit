export type PdfSelection = {
  text: string;
  pageIndex: number;
  quads: number[][];
};

/** 页码必须是非负整数。小数、负数和非数字都不跳转。 */
export function isPdfPageIndex(pageIndex: number): boolean {
  return Number.isInteger(pageIndex) && pageIndex >= 0;
}

/** 空白选区丢掉。其余去掉首尾空白，quads 缺省为空数组。 */
export function pdfSelectionFrom(
  text: string,
  pageIndex: number,
  quads: number[][] = [],
): PdfSelection | null {
  const quote = text.trim();
  if (!quote) return null;
  return { text: quote, pageIndex, quads };
}
