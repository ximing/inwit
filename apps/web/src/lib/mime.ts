export const PDF_MIME = 'application/pdf';

export function isPdfMime(mime: string | null | undefined): boolean {
  return mime === PDF_MIME;
}
