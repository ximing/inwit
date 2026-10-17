import { describe, expect, it } from 'vitest';
import { conceptsReadable, conceptsWritable, healthStatus } from './concepts-flag.js';

describe('concepts-flag', () => {
  it('概念读写始终开放，健康检查也如此报告', () => {
    expect(conceptsReadable()).toBe(true);
    expect(conceptsWritable()).toBe(true);
    expect(healthStatus()).toEqual({ ok: true, conceptsEnabled: true, conceptsWritable: true });
  });
});
