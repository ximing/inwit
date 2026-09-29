import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import {
  codeLanguageChoices,
  codeLanguageValue,
  filterCodeLanguageChoices,
  type CodeLanguageChoice,
} from './code-language.js';

function readPos(getPos: NodeViewRendererProps['getPos']): number | null {
  if (typeof getPos !== 'function') return null;
  const pos = getPos();
  return typeof pos === 'number' ? pos : null;
}

function choiceLabel(language: unknown, value: string): string {
  if (value === '') return '自动';
  const raw = typeof language === 'string' ? language : null;
  for (const choice of codeLanguageChoices(raw)) {
    if (choice.value === value) return choice.label;
  }
  return value;
}

function storedLanguage(node: ProseMirrorNode): string | null {
  const language = node.attrs.language;
  if (typeof language !== 'string') return null;
  const trimmed = language.trim();
  return trimmed === '' ? null : trimmed;
}

/** One open menu. A second code block closes the first. */
let closeOpenMenu: (() => void) | null = null;

/**
 * Code block chrome: a language button while editing, a quiet label while reading.
 * The list is fixed to the document so pane overflow does not clip it.
 * Highlighting stays on CodeBlockLowlight; this view only edits `language`.
 */
export const codeBlockNodeView: NodeViewRenderer = ({ editor, node, getPos, HTMLAttributes }) => {
  let current = node;

  const wrapper = document.createElement('div');
  wrapper.className = 'doc-code';
  const extra = HTMLAttributes['class'];
  if (typeof extra === 'string' && extra !== '') {
    for (const name of extra.split(/\s+/)) {
      if (name !== '') wrapper.classList.add(name);
    }
  }

  const bar = document.createElement('div');
  bar.className = 'doc-code-lang';
  bar.setAttribute('contenteditable', 'false');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'doc-code-lang-btn';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'doc-code-lang-list');
  const triggerLabel = document.createElement('span');
  trigger.append(triggerLabel);

  const name = document.createElement('span');
  name.className = 'doc-code-lang-name';

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  bar.append(trigger, name);
  pre.append(code);
  wrapper.append(bar, pre);

  let menu: HTMLDivElement | null = null;
  let filter: HTMLInputElement | null = null;
  let list: HTMLDivElement | null = null;
  let query = '';
  let activeIndex = 0;
  let onPointerDown: ((event: PointerEvent) => void) | null = null;
  let onScroll: ((event: Event) => void) | null = null;
  let onResize: (() => void) | null = null;
  let closeFromOutside: (() => void) | null = null;

  const visibleChoices = (): CodeLanguageChoice[] =>
    filterCodeLanguageChoices(codeLanguageChoices(storedLanguage(current)), query);

  const scrollActive = (): void => {
    const active = list?.querySelector<HTMLElement>('.is-active');
    if (!active || !list) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };

  const markSelected = (): void => {
    if (!list || !filter) return;
    const selected = codeLanguageValue(current.attrs.language);
    const buttons = list.querySelectorAll<HTMLButtonElement>('button');
    if (buttons.length === 0) {
      filter.removeAttribute('aria-activedescendant');
      return;
    }
    if (activeIndex >= buttons.length) activeIndex = buttons.length - 1;
    buttons.forEach((option, index) => {
      const on = option.getAttribute('data-value') === selected;
      option.classList.toggle('is-on', on);
      option.classList.toggle('is-active', index === activeIndex);
      option.setAttribute('aria-selected', on ? 'true' : 'false');
      if (index === activeIndex) option.id = 'doc-code-lang-active';
      else option.removeAttribute('id');
    });
    filter.setAttribute('aria-activedescendant', 'doc-code-lang-active');
  };

  const renderList = (scroll: boolean): void => {
    if (!list || !filter) return;
    const items = visibleChoices();
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'doc-code-menu-empty';
      empty.textContent = '没有匹配的语言';
      list.append(empty);
      filter.removeAttribute('aria-activedescendant');
      return;
    }
    if (activeIndex >= items.length) activeIndex = items.length - 1;
    items.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'doc-code-menu-option';
      option.setAttribute('role', 'option');
      option.setAttribute('data-value', item.value);
      option.textContent = item.label;
      option.addEventListener('pointermove', () => {
        if (activeIndex === index) return;
        activeIndex = index;
        markSelected();
      });
      option.addEventListener('click', () => commit(item.value));
      list?.append(option);
    });
    markSelected();
    if (scroll) scrollActive();
  };

  const closeMenu = (focusTrigger: boolean): void => {
    if (!menu) {
      if (focusTrigger) trigger.focus();
      return;
    }
    menu.remove();
    menu = null;
    filter = null;
    list = null;
    query = '';
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (onPointerDown) document.removeEventListener('pointerdown', onPointerDown, true);
    if (onScroll) document.removeEventListener('scroll', onScroll, true);
    if (onResize) window.removeEventListener('resize', onResize);
    onPointerDown = null;
    onScroll = null;
    onResize = null;
    if (closeFromOutside && closeOpenMenu === closeFromOutside) closeOpenMenu = null;
    if (focusTrigger) trigger.focus();
  };

  closeFromOutside = (): void => {
    closeMenu(false);
  };

  const place = (): void => {
    if (!menu) return;
    if (!trigger.isConnected) {
      closeMenu(false);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    if (
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    ) {
      closeMenu(false);
      return;
    }
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const gap = 4;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin && rect.top - gap - height >= margin) {
      top = rect.top - gap - height;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  const commit = (value: string): void => {
    closeMenu(false);
    const pos = readPos(getPos);
    if (pos === null) return;
    const next = value === '' ? null : value;
    const block = editor.state.doc.nodeAt(pos);
    if (!block || block.type.name !== 'codeBlock') return;
    const stored = storedLanguage(block);
    const same = stored === next || (next !== null && codeLanguageValue(stored) === next);
    if (!same) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, null, { ...block.attrs, language: next }),
      );
    }
    const updated = editor.state.doc.nodeAt(pos);
    const selection = editor.state.selection;
    if (updated && selection.from > pos && selection.to < pos + updated.nodeSize) {
      editor.view.focus();
    } else {
      trigger.focus();
    }
  };

  const openMenu = (): void => {
    if (menu || !editor.isEditable) return;
    closeOpenMenu?.();
    query = '';
    const items = codeLanguageChoices(storedLanguage(current));
    const selected = codeLanguageValue(current.attrs.language);
    const selectedIndex = items.findIndex((item) => item.value === selected);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const popup = document.createElement('div');
    const field = document.createElement('input');
    const options = document.createElement('div');
    menu = popup;
    filter = field;
    list = options;

    popup.className = 'doc-code-menu';
    field.type = 'text';
    field.className = 'doc-code-menu-filter';
    field.placeholder = '筛选语言';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', '筛选语言');
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', 'doc-code-lang-list');
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('autocorrect', 'off');
    options.id = 'doc-code-lang-list';
    options.className = 'doc-code-menu-list';
    options.setAttribute('role', 'listbox');
    options.setAttribute('aria-label', '代码语言');
    popup.append(field, options);
    popup.style.visibility = 'hidden';
    popup.addEventListener('mousedown', (event) => {
      if (event.target === field) return;
      event.preventDefault();
    });
    document.body.append(popup);
    renderList(true);
    place();
    if (!menu) return;
    popup.style.visibility = 'visible';
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    closeOpenMenu = closeFromOutside;

    field.addEventListener('input', () => {
      query = field.value;
      const now = visibleChoices();
      const selectedNow = codeLanguageValue(current.attrs.language);
      const keep = now.findIndex((item) => item.value === selectedNow);
      activeIndex = keep >= 0 ? keep : 0;
      renderList(true);
    });
    field.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      const now = visibleChoices();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (now.length === 0) return;
        activeIndex = (activeIndex + 1) % now.length;
        markSelected();
        scrollActive();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (now.length === 0) return;
        activeIndex = (activeIndex - 1 + now.length) % now.length;
        markSelected();
        scrollActive();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = now[activeIndex];
        if (item) commit(item.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (event.key === 'Tab') {
        trigger.focus();
        closeMenu(false);
      }
    });

    onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popup.contains(target) || trigger.contains(target)) return;
      closeMenu(false);
    };
    onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popup.contains(target)) return;
      place();
    };
    onResize = () => place();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    field.focus({ preventScroll: true });
  };

  const toggle = (): void => {
    if (menu) closeMenu(false);
    else openMenu();
  };

  trigger.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    toggle();
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
  });
  trigger.addEventListener('keydown', (event) => {
    if (menu) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  });

  const sync = (): void => {
    const editable = editor.isEditable;
    const stored = current.attrs.language;
    const value = codeLanguageValue(stored);
    const label = choiceLabel(stored, value);
    triggerLabel.textContent = label;
    trigger.setAttribute('aria-label', `代码语言：${label}`);
    name.textContent = label;
    trigger.hidden = !editable;
    name.hidden = editable || value === '';
    bar.hidden = !editable && value === '';
    wrapper.classList.toggle('is-editing', editable);
    wrapper.classList.toggle('is-bare', bar.hidden);
    const raw = storedLanguage(current);
    if (raw) wrapper.dataset.language = raw;
    else delete wrapper.dataset.language;
    if (!editable) closeMenu(false);
    else markSelected();
  };

  const onEditor = (): void => {
    sync();
  };
  editor.on('transaction', onEditor);
  editor.on('update', onEditor);
  sync();

  const view: NodeView = {
    dom: wrapper,
    contentDOM: code,
    update(updated) {
      if (updated.type !== current.type) return false;
      current = updated;
      sync();
      return true;
    },
    stopEvent(event) {
      const target = event.target;
      return target instanceof Element && target.closest('.doc-code-lang') !== null;
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false;
      const target = mutation.target;
      return target !== code && !code.contains(target);
    },
    destroy() {
      closeMenu(false);
      editor.off('transaction', onEditor);
      editor.off('update', onEditor);
    },
  };
  return view;
};
