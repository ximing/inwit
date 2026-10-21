import { describe, expect, it } from 'vitest';
import { digestCoverageGap } from './digest-coverage-logic.js';

describe('digestCoverageGap', () => {
  it('leaves a short article alone', () => {
    expect(
      digestCoverageGap({
        lastBlockIndex: 8,
        readThrough: 3,
        truncated: true,
        anchors: [1],
      }),
    ).toBeNull();
  });

  it('asks to keep reading when the slice stopped early', () => {
    const message = digestCoverageGap({
      lastBlockIndex: 80,
      readThrough: 20,
      truncated: true,
      anchors: [4, 12],
    });
    expect(message).toContain('fromBlock 用 21');
  });

  it('asks for later cards when anchors stay in the first half', () => {
    const message = digestCoverageGap({
      lastBlockIndex: 100,
      readThrough: 100,
      truncated: false,
      anchors: [6, 18, 30],
    });
    expect(message).toContain('最远块 30');
  });

  it('accepts a long article whose cards reach the later half', () => {
    expect(
      digestCoverageGap({
        lastBlockIndex: 100,
        readThrough: 100,
        truncated: false,
        anchors: [12, 70],
      }),
    ).toBeNull();
  });
});
