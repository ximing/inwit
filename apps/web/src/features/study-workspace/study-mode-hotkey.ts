import type { StudyMode } from './study-state.js';

/** 学习区三视图：1 结构，2 概念，3 对照。输入框和对话框里不响应。 */
export function studyModeFromKey(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}): StudyMode | null {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === '1' || event.code === 'Digit1' || event.code === 'Numpad1') return 'outline';
  if (event.key === '2' || event.code === 'Digit2' || event.code === 'Numpad2') return 'concepts';
  if (event.key === '3' || event.code === 'Digit3' || event.code === 'Numpad3') return 'compare';
  return null;
}

export function shortcutBlockedTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
  }
  return target.closest('[contenteditable="true"], [role="dialog"], [role="alertdialog"]') != null;
}
