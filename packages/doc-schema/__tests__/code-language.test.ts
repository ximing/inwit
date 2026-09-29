import { describe, expect, it } from 'vitest';
import {
  CODE_LANGUAGES,
  codeLanguageChoices,
  codeLanguageValue,
  filterCodeLanguageChoices,
  resolveCodeLanguage,
} from '../src/schema/code-language.js';

describe('resolveCodeLanguage', () => {
  it('maps fence aliases onto highlight ids', () => {
    expect(resolveCodeLanguage('js')).toBe('javascript');
    expect(resolveCodeLanguage('JSX')).toBe('javascript');
    expect(resolveCodeLanguage('ts')).toBe('typescript');
    expect(resolveCodeLanguage('tsx')).toBe('typescript');
    expect(resolveCodeLanguage('py')).toBe('python');
    expect(resolveCodeLanguage('c++')).toBe('cpp');
    expect(resolveCodeLanguage('C#')).toBe('csharp');
    expect(resolveCodeLanguage('html')).toBe('html');
    expect(resolveCodeLanguage('htm')).toBe('html');
    expect(resolveCodeLanguage('yml')).toBe('yaml');
    expect(resolveCodeLanguage('sh')).toBe('bash');
    expect(resolveCodeLanguage('shell')).toBe('shell');
    expect(resolveCodeLanguage('md')).toBe('markdown');
    expect(resolveCodeLanguage('rs')).toBe('rust');
  });

  it('keeps canonical ids and unknown languages', () => {
    expect(resolveCodeLanguage('Rust')).toBe('rust');
    expect(resolveCodeLanguage('haskell')).toBe('haskell');
    expect(resolveCodeLanguage('')).toBeNull();
    expect(resolveCodeLanguage('   ')).toBeNull();
  });
});

describe('codeLanguageChoices', () => {
  it('starts with auto and plaintext, and keeps an unknown current value', () => {
    const choices = codeLanguageChoices('haskell');
    expect(choices[0]).toEqual({ value: '', label: '自动' });
    expect(choices[1]).toEqual({ value: 'plaintext', label: '纯文本' });
    expect(choices.filter((item) => item.value === 'javascript')).toHaveLength(1);
    expect(choices.at(-1)).toEqual({ value: 'haskell', label: 'haskell' });
    expect(CODE_LANGUAGES).toHaveLength(choices.length - 2);
  });

  it('does not add a second option for an alias', () => {
    const choices = codeLanguageChoices('js');
    expect(choices.some((item) => item.value === 'js')).toBe(false);
    expect(codeLanguageValue('js')).toBe('javascript');
    expect(codeLanguageValue(null)).toBe('');
    expect(codeLanguageValue(3)).toBe('');
  });

  it('filters by label, id, and fence alias', () => {
    const choices = codeLanguageChoices('haskell');
    expect(filterCodeLanguageChoices(choices, '  ')).toHaveLength(choices.length);
    expect(filterCodeLanguageChoices(choices, 'ts').map((item) => item.value)).toEqual(['typescript']);
    expect(filterCodeLanguageChoices(choices, 'sh').map((item) => item.value)).toEqual(['bash', 'shell']);
    expect(filterCodeLanguageChoices(choices, 'script').map((item) => item.value)).toEqual([
      'javascript',
      'typescript',
    ]);
    expect(filterCodeLanguageChoices(choices, '纯').map((item) => item.label)).toEqual(['纯文本']);
    expect(filterCodeLanguageChoices(choices, 'HASKELL').map((item) => item.value)).toEqual(['haskell']);
    expect(filterCodeLanguageChoices(choices, 'zzz')).toEqual([]);
  });
});
