import { describe, expect, it } from 'vitest';
import { createImeEnterSession, imeBlocksEnter, type ImeEnterSnapshot } from './ime-enter';

function enter(patch: Partial<ImeEnterSnapshot> = {}): ImeEnterSnapshot {
  return { key: 'Enter', keyCode: 13, isComposing: false, timeStamp: 1_000, ...patch };
}

describe('imeBlocksEnter', () => {
  it('allows a plain Enter outside composition', () => {
    const session = createImeEnterSession();
    expect(session.blocks(enter())).toBe(false);
  });

  it('blocks Enter while a composition is open, even if isComposing is already false', () => {
    const session = createImeEnterSession();
    session.start();
    expect(session.blocks(enter({ isComposing: false, keyCode: 13 }))).toBe(true);
  });

  it('blocks the IME process key and keyCode 229', () => {
    const session = createImeEnterSession();
    expect(session.blocks(enter({ isComposing: true, keyCode: 229 }))).toBe(true);
    expect(imeBlocksEnter(enter({ keyCode: 229 }), session.state)).toBe(true);
  });

  it('blocks the Enter that follows compositionend within the confirm window', () => {
    const session = createImeEnterSession();
    session.start();
    session.end(1_000);
    expect(session.blocks(enter({ timeStamp: 1_020 }))).toBe(true);
    expect(session.blocks(enter({ timeStamp: 980 }))).toBe(true);
    expect(session.blocks(enter({ timeStamp: 1_080 }))).toBe(false);
  });

  it('does not treat other keys as submit blockers', () => {
    const session = createImeEnterSession();
    session.start();
    expect(session.blocks(enter({ key: 'Escape' }))).toBe(false);
  });
});

describe('runAfter', () => {
  it('drops the Enter when compositionend arrives in the same turn', () => {
    const session = createImeEnterSession();
    const queued: Array<() => void> = [];
    session.schedule = (run) => queued.push(run);
    let sent = 0;
    session.runAfter(enter({ timeStamp: 5_000 }), () => {
      sent += 1;
    });
    session.end(5_010);
    queued.shift()?.();
    expect(sent).toBe(0);
  });

  it('sends a later Enter after the confirm window', () => {
    const session = createImeEnterSession();
    const queued: Array<() => void> = [];
    session.schedule = (run) => queued.push(run);
    let sent = 0;
    session.start();
    session.end(5_000);
    session.runAfter(enter({ timeStamp: 5_200 }), () => {
      sent += 1;
    });
    queued.shift()?.();
    expect(sent).toBe(1);
  });

  it('does not schedule a send for the confirming Enter', () => {
    const session = createImeEnterSession();
    let scheduled = 0;
    session.schedule = () => {
      scheduled += 1;
    };
    session.start();
    session.runAfter(enter(), () => undefined);
    expect(scheduled).toBe(0);
  });
});
