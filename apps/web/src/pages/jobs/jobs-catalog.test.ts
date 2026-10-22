import { JOB_TYPES as DTO_JOB_TYPES } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { JOB_TYPE_LABELS, JOB_TYPES } from './jobs.service.js';

describe('JOB_TYPES catalog', () => {
  it('re-exports the dto list', () => {
    expect(JOB_TYPES).toBe(DTO_JOB_TYPES);
  });

  it('labels every job type', () => {
    for (const type of JOB_TYPES) {
      expect(JOB_TYPE_LABELS[type]?.trim().length).toBeGreaterThan(0);
    }
  });
});
