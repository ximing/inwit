import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from './assistant-markdown-view';

function html(text: string, live = false): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AssistantMarkdown text={text} live={live} />
    </MemoryRouter>,
  );
}

describe('AssistantMarkdown', () => {
  it('renders markdown and escapes raw html', () => {
    const markup = html('## 标题\n\n这是 **粗体**\n\n- 一项\n\n<script>alert(1)</script>\n\n[站内](/docs)\n\n[坏](javascript:alert(1))');
    expect(markup).toContain('<h2>标题</h2>');
    expect(markup).toContain('<strong>粗体</strong>');
    expect(markup).toContain('<li>一项');
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('href="/docs"');
    expect(markup).not.toContain('javascript:');
  });

  it('places a caret while the reply is still pending', () => {
    expect(html('还在写', true)).toContain('assistant-caret');
  });
});
