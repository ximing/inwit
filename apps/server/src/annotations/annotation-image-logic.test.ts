import { describe, expect, it } from 'vitest';
import { isAnnotationImageKeyFor } from './annotation-image-logic.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const DOC = '22222222-2222-4222-8222-222222222222';
const FILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('isAnnotationImageKeyFor', () => {
  it('accepts excerpt keys owned by the user and document', () => {
    expect(
      isAnnotationImageKeyFor(USER, DOC, `docs/${USER}/${DOC}/excerpts/${FILE}.png`),
    ).toBe(true);
  });

  it('accepts doc-asset keys owned by the user', () => {
    expect(isAnnotationImageKeyFor(USER, DOC, `users/${USER}/doc-assets/${FILE}.webp`)).toBe(true);
  });

  it('rejects keys owned by another user', () => {
    expect(
      isAnnotationImageKeyFor(USER, DOC, `docs/${OTHER_USER}/${DOC}/excerpts/${FILE}.png`),
    ).toBe(false);
    expect(isAnnotationImageKeyFor(USER, DOC, `users/${OTHER_USER}/doc-assets/${FILE}.png`)).toBe(
      false,
    );
  });

  it('rejects excerpt keys from another document and malformed keys', () => {
    expect(
      isAnnotationImageKeyFor(USER, DOC, `docs/${USER}/${OTHER_USER}/excerpts/${FILE}.png`),
    ).toBe(false);
    expect(isAnnotationImageKeyFor(USER, DOC, `users/${USER}/doc-assets/${FILE}`)).toBe(false);
    expect(isAnnotationImageKeyFor(USER, DOC, `users/${USER}/other/${FILE}.png`)).toBe(false);
    expect(isAnnotationImageKeyFor(USER, DOC, `docs/${USER}/${DOC}/excerpts/../../x.png`)).toBe(
      false,
    );
  });
});
