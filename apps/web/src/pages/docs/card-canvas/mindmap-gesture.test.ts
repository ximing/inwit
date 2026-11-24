import { describe, expect, it } from 'vitest';
import {
  decideMindGesture,
  mindCardActions,
  mindDeleteAction,
  mindNodeChatLabel,
  mindDraftAfter,
  mindDraftDirty,
  mindDraftKeyCommand,
} from './mindmap-gesture';

const shown = {
  confirm: true,
  problem: true,
  suspend: true,
  archive: true,
  links: true,
};
const hidden = {
  confirm: false,
  problem: false,
  suspend: false,
  archive: false,
  links: false,
};

describe('mind map gesture', () => {
  it('selects a card or annotation and asks the document to reveal, without editing', () => {
    expect(decideMindGesture({ action: 'click', kind: 'card', repeat: false })).toEqual({
      type: 'select',
      reveal: true,
    });
    expect(decideMindGesture({ action: 'click', kind: 'annotation', repeat: false })).toEqual({
      type: 'select',
      reveal: true,
    });
    expect(decideMindGesture({ action: 'arrow', kind: 'card' })).toEqual({
      type: 'select',
      reveal: true,
    });
    expect(decideMindGesture({ action: 'arrow', kind: 'annotation' })).toEqual({
      type: 'select',
      reveal: true,
    });
  });

  it('keeps the selection when the same card or annotation is clicked again', () => {
    expect(decideMindGesture({ action: 'click', kind: 'card', repeat: true })).toEqual({
      type: 'select',
      reveal: true,
    });
    expect(decideMindGesture({ action: 'click', kind: 'annotation', repeat: true })).toEqual({
      type: 'select',
      reveal: true,
    });
  });

  it('selects text and image nodes without revealing the document', () => {
    expect(decideMindGesture({ action: 'click', kind: 'text', repeat: false })).toEqual({
      type: 'select',
      reveal: false,
    });
    expect(decideMindGesture({ action: 'click', kind: 'image', repeat: true })).toEqual({
      type: 'select',
      reveal: false,
    });
    expect(decideMindGesture({ action: 'arrow', kind: 'text' })).toEqual({
      type: 'select',
      reveal: false,
    });
    expect(decideMindGesture({ action: 'arrow', kind: 'image' })).toEqual({
      type: 'select',
      reveal: false,
    });
  });

  it('clears the selection on empty canvas and ignores a drag', () => {
    expect(decideMindGesture({ action: 'empty' })).toEqual({ type: 'clear' });
    expect(decideMindGesture({ action: 'drag' })).toEqual({ type: 'ignore' });
  });

  it('edits on double-click or Enter, and does nothing for an image', () => {
    expect(decideMindGesture({ action: 'double-click', kind: 'text' })).toEqual({
      type: 'edit',
      editor: 'inline-text',
    });
    expect(decideMindGesture({ action: 'enter', kind: 'text' })).toEqual({
      type: 'edit',
      editor: 'inline-text',
    });
    expect(decideMindGesture({ action: 'double-click', kind: 'card' })).toEqual({
      type: 'edit',
      editor: 'card-dialog',
    });
    expect(decideMindGesture({ action: 'enter', kind: 'card' })).toEqual({
      type: 'edit',
      editor: 'card-dialog',
    });
    expect(decideMindGesture({ action: 'double-click', kind: 'annotation' })).toEqual({
      type: 'edit',
      editor: 'inline-note',
    });
    expect(decideMindGesture({ action: 'enter', kind: 'annotation' })).toEqual({
      type: 'edit',
      editor: 'inline-note',
    });
    expect(decideMindGesture({ action: 'double-click', kind: 'image' })).toEqual({
      type: 'edit',
      editor: 'none',
    });
    expect(decideMindGesture({ action: 'enter', kind: 'image' })).toEqual({
      type: 'edit',
      editor: 'none',
    });
  });

  it('deletes every node kind: cards and annotations go to the recycle bin', () => {
    expect(mindDeleteAction('card')).toBe('archive-card');
    expect(mindDeleteAction('annotation')).toBe('remove-annotation');
    expect(mindDeleteAction('text')).toBe('remove-node');
    expect(mindDeleteAction('image')).toBe('remove-node');
  });

  it('labels a mind-map node from the first line of its visible text', () => {
    expect(mindNodeChatLabel({ kind: 'card', concept: '梯度\n是方向' })).toBe('梯度');
    expect(mindNodeChatLabel({ kind: 'annotation', quote: '引文', note: '  ' })).toBe('引文');
    expect(mindNodeChatLabel({ kind: 'image' })).toBe('图片');
    expect(mindNodeChatLabel({ kind: 'text', text: '' })).toBe('文本');
  });

  it('cancels a text or note draft on Escape and commits on Enter, Shift+Enter stays a newline', () => {
    expect(mindDraftKeyCommand('Escape', false)).toBe('cancel');
    expect(mindDraftKeyCommand('Escape', true)).toBe('cancel');
    expect(mindDraftAfter('原文', '改过', 'cancel')).toEqual({ text: '原文', save: false });
    expect(mindDraftKeyCommand('Enter', false)).toBe('commit');
    expect(mindDraftKeyCommand('Enter', true)).toBe('commit');
    expect(mindDraftKeyCommand('Enter', false, true)).toBeNull();
    expect(mindDraftKeyCommand('Enter', true, true)).toBe('commit');
    expect(mindDraftDirty('原文', '改过')).toBe(true);
    expect(mindDraftDirty('原文', '原文')).toBe(false);
    expect(mindDraftDirty('原文', '  原文  ')).toBe(false);
    expect(mindDraftAfter('原文', '改过', 'commit')).toEqual({ text: '改过', save: true });
    expect(mindDraftAfter('原文', '  原文  ', 'commit')).toEqual({ text: '  原文  ', save: false });
    expect(decideMindGesture({ action: 'escape', editing: true })).toEqual({ type: 'cancel-draft' });
    expect(decideMindGesture({ action: 'escape', editing: false })).toEqual({ type: 'clear' });
  });
});

describe('mind map card actions', () => {
  it('shows confirm, problem, suspend, archive, and links for a selected canvas card that is not expanded', () => {
    expect(mindCardActions({ expanded: false, canvasSelected: true })).toEqual(shown);
  });

  it('hides them when the card is neither selected nor expanded', () => {
    expect(mindCardActions({ expanded: false, canvasSelected: false })).toEqual(hidden);
  });

  it('keeps them for an expanded list-mode card', () => {
    expect(mindCardActions({ expanded: true, canvasSelected: false })).toEqual(shown);
  });
});
