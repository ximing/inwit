import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { conceptsReadable, conceptsWritable, healthStatus } from './concepts-flag.js';

type ConceptFlags = {
  CONCEPTS_ENABLED: boolean;
  CONCEPTS_READ_ENABLED: boolean | undefined;
  CONCEPTS_WRITE_ENABLED: boolean | undefined;
};

function flags(): ConceptFlags {
  return config as ConceptFlags;
}

const initial = {
  enabled: config.CONCEPTS_ENABLED,
  read: config.CONCEPTS_READ_ENABLED,
  write: config.CONCEPTS_WRITE_ENABLED,
};

function setFlags(enabled: boolean, read: boolean | undefined, write: boolean | undefined): void {
  const current = flags();
  current.CONCEPTS_ENABLED = enabled;
  current.CONCEPTS_READ_ENABLED = read;
  current.CONCEPTS_WRITE_ENABLED = write;
}

afterEach(() => {
  setFlags(initial.enabled, initial.read, initial.write);
});

describe('concepts-flag', () => {
  it('可选开关未设置时跟随主开关', () => {
    expect(config.CONCEPTS_READ_ENABLED).toBeUndefined();
    expect(config.CONCEPTS_WRITE_ENABLED).toBeUndefined();

    setFlags(false, undefined, undefined);
    expect(conceptsReadable()).toBe(false);
    expect(conceptsWritable()).toBe(false);
    expect(healthStatus()).toEqual({ ok: true, conceptsEnabled: false, conceptsWritable: false });

    setFlags(true, undefined, undefined);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(true);
    expect(healthStatus()).toEqual({ ok: true, conceptsEnabled: true, conceptsWritable: true });
  });

  it('读开写关时入口可见但不接受写入', () => {
    setFlags(true, true, false);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(false);
    expect(healthStatus()).toEqual({ ok: true, conceptsEnabled: true, conceptsWritable: false });

    setFlags(false, true, false);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(false);
  });

  it('读关闭时写开关不能单独打开', () => {
    setFlags(true, false, true);
    expect(conceptsReadable()).toBe(false);
    expect(conceptsWritable()).toBe(false);
    expect(healthStatus()).toEqual({ ok: true, conceptsEnabled: false, conceptsWritable: false });
  });

  it('只设置其中一个可选开关时，另一个跟随主开关', () => {
    setFlags(true, undefined, false);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(false);

    setFlags(false, true, undefined);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(false);

    setFlags(false, undefined, true);
    expect(conceptsReadable()).toBe(false);
    expect(conceptsWritable()).toBe(false);

    setFlags(false, true, true);
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(true);
  });
});
