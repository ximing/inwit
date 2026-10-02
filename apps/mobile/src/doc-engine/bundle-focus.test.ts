import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bundlePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/doc-engine.html',
);

describe('shipped doc-engine bundle', () => {
  it('focuses a text annotation mark, not only a card mark', () => {
    const html = fs.readFileSync(bundlePath, 'utf8');
    const focus = html.match(
      /\.find\(([A-Za-z_$][\w$]*)=>([A-Za-z_$][\w$]*)\(\1\)\.includes\(([A-Za-z_$][\w$]*)\)\|\|([A-Za-z_$][\w$]*)\(\1\)\.includes\(\3\)\)[\s\S]{0,500}?scrollIntoView[\s\S]{0,240}?is-flash/,
    );
    expect(focus).not.toBeNull();
    const helpers = [focus?.[2], focus?.[4]];
    expect(new Set(helpers).size).toBe(2);
    const bodies = helpers.map((name) => {
      const fn = html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[^}]*\\}`));
      expect(fn, name).not.toBeNull();
      return fn?.[0] ?? '';
    });
    expect(bodies.some((body) => body.includes('data-card-ids') && body.includes('data-card-id'))).toBe(
      true,
    );
    expect(
      bodies.some((body) => body.includes('data-annotation-ids') && body.includes('data-annotation-id')),
    ).toBe(true);
  });
});
