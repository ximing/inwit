import {
  ANCHOR_HIT_SELECTOR,
  annotationIdsFromAnchor,
  cardIdsFromAnchor,
} from './anchors';

function flashAnchorElement(hit: HTMLElement): void {
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  hit.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  hit.classList.add('is-flash');
  window.setTimeout(() => hit.classList.remove('is-flash'), 1100);
}

function scrollFlashHit(
  root: ParentNode | null | undefined,
  match: (el: Element) => boolean,
): boolean {
  if (!root) return false;
  const hit = [...root.querySelectorAll(ANCHOR_HIT_SELECTOR)].find(match);
  if (!(hit instanceof HTMLElement)) return false;
  flashAnchorElement(hit);
  return true;
}

/** 在 root 内找到卡片锚点，滚入视口并闪烁 1.1s。 */
export function scrollFlashCardAnchor(
  root: ParentNode | null | undefined,
  cardId: string,
): boolean {
  if (!cardId) return false;
  return scrollFlashHit(root, (el) => cardIdsFromAnchor(el).includes(cardId));
}

/** 在 root 内找到批注锚点，滚入视口并闪烁 1.1s。 */
export function scrollFlashAnnotationAnchor(
  root: ParentNode | null | undefined,
  annotationId: string,
): boolean {
  if (!annotationId) return false;
  return scrollFlashHit(root, (el) => annotationIdsFromAnchor(el).includes(annotationId));
}
