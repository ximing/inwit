import { describe, expect, it } from 'vitest';
import { studyModeFromKey } from './study-mode-hotkey.js';

const plain = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe('studyModeFromKey', () => {
  it('1 2 3 对应结构、概念、对照', () => {
    expect(studyModeFromKey({ ...plain, key: '1' })).toBe('outline');
    expect(studyModeFromKey({ ...plain, key: '2' })).toBe('concepts');
    expect(studyModeFromKey({ ...plain, key: '3' })).toBe('compare');
    expect(studyModeFromKey({ ...plain, key: 'Unidentified', code: 'Numpad2' })).toBe('concepts');
  });

  it('组合键、输入法组字和其他按键不切换', () => {
    expect(studyModeFromKey({ ...plain, key: '1', metaKey: true })).toBeNull();
    expect(studyModeFromKey({ ...plain, key: '2', ctrlKey: true })).toBeNull();
    expect(studyModeFromKey({ ...plain, key: '3', altKey: true })).toBeNull();
    expect(studyModeFromKey({ ...plain, key: '!', shiftKey: true, code: 'Digit1' })).toBeNull();
    expect(studyModeFromKey({ ...plain, key: '1', isComposing: true })).toBeNull();
    expect(studyModeFromKey({ ...plain, key: 'n' })).toBeNull();
  });
});
