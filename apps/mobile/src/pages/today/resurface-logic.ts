import type { AnnotationResurface } from '@inwit/dto';

export type ResurfacePrompt = {
  visible: boolean;
  count: number;
  documentTitle: string | null;
  subtitle: string;
};

export function resurfacePrompt(resurface: AnnotationResurface | null): ResurfacePrompt {
  const count = resurface?.annotations.length ?? 0;
  if (!resurface || count < 1) {
    return { visible: false, count: 0, documentTitle: null, subtitle: '' };
  }
  const documentTitle = resurface.annotations[0]?.documentTitle?.trim() || null;
  const example = documentTitle ? `，比如《${documentTitle}》里的那条` : '';
  return {
    visible: true,
    count,
    documentTitle,
    subtitle: `你有 ${String(count)} 条两周前的批注还没消化成卡片${example}。`,
  };
}

/** A missing or empty payload hides the prompt. */
export function resurfaceAfterLoad(payload: AnnotationResurface | null): AnnotationResurface | null {
  if (!resurfacePrompt(payload).visible) return null;
  return payload;
}

export function resurfaceAfterAccept(next: AnnotationResurface | null): AnnotationResurface | null {
  return resurfaceAfterLoad(next);
}

export function resurfaceAfterDismiss(): null {
  return null;
}
