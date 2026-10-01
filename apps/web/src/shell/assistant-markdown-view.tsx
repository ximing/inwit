import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  parseAssistantMarkdown,
  safeHref,
  safeImageSrc,
  type MdBlock,
  type MdInline,
  type MdItem,
} from './assistant-markdown';

export function AssistantMarkdown({ text, live = false }: { text: string; live?: boolean }) {
  const blocks = useMemo(() => parseAssistantMarkdown(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <div className={live ? 'assistant-md is-live' : 'assistant-md'}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} caret={live && index === blocks.length - 1} />
      ))}
    </div>
  );
}

function Caret() {
  return <span className="assistant-caret" aria-hidden="true" />;
}

function BlockView({ block, caret }: { block: MdBlock; caret: boolean }) {
  switch (block.t) {
    case 'p':
      return (
        <p>
          <Inlines nodes={block.c} />
          {caret ? <Caret /> : null}
        </p>
      );
    case 'h': {
      const Tag = `h${String(block.level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag>
          <Inlines nodes={block.c} />
          {caret ? <Caret /> : null}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote>
          {block.c.map((child, index) => (
            <BlockView key={index} block={child} caret={caret && index === block.c.length - 1} />
          ))}
        </blockquote>
      );
    case 'ul':
    case 'ol':
      return (
        <ListView
          ordered={block.t === 'ol'}
          start={block.t === 'ol' ? block.start : 1}
          items={block.items}
          caret={caret}
        />
      );
    case 'code':
      return (
        <div className="assistant-code">
          {block.lang ? <span className="assistant-code-lang">{block.lang}</span> : null}
          <pre>
            <code>{block.v}</code>
            {caret ? <Caret /> : null}
          </pre>
        </div>
      );
    case 'hr':
      return <hr />;
    case 'table':
      return (
        <div className="assistant-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} style={alignStyle(block.align[index])}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={alignStyle(block.align[index])}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {caret ? <Caret /> : null}
        </div>
      );
    default:
      return null;
  }
}

function ListView({
  ordered,
  start,
  items,
  caret,
}: {
  ordered: boolean;
  start: number;
  items: MdItem[];
  caret: boolean;
}) {
  const children = items.map((item, index) => (
    <ItemView key={index} item={item} caret={caret && index === items.length - 1} />
  ));
  if (ordered) return <ol start={start}>{children}</ol>;
  return <ul>{children}</ul>;
}

function ItemView({ item, caret }: { item: MdItem; caret: boolean }) {
  const [first, ...rest] = item.c;
  const lead = first?.t === 'p' ? <Inlines nodes={first.c} /> : null;
  const tail = first?.t === 'p' ? rest : item.c;
  return (
    <li className={item.checked === null ? undefined : 'is-task'}>
      {item.checked === null ? null : <input type="checkbox" disabled checked={item.checked} />}
      {lead}
      {tail.map((child, index) => (
        <BlockView key={index} block={child} caret={caret && index === tail.length - 1} />
      ))}
      {caret && tail.length === 0 ? <Caret /> : null}
    </li>
  );
}

function Inlines({ nodes }: { nodes: MdInline[] }) {
  return nodes.map((node, index) => <InlineView key={index} node={node} />);
}

function InlineView({ node }: { node: MdInline }): ReactNode {
  switch (node.t) {
    case 'text':
      return node.v;
    case 'br':
      return <br />;
    case 'code':
      return <code>{node.v}</code>;
    case 'strong':
      return (
        <strong>
          <Inlines nodes={node.c} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Inlines nodes={node.c} />
        </em>
      );
    case 'del':
      return (
        <del>
          <Inlines nodes={node.c} />
        </del>
      );
    case 'link': {
      const href = safeHref(node.href);
      const children = <Inlines nodes={node.c} />;
      if (!href) return <span>{children}</span>;
      if (href.startsWith('/')) return <Link to={href}>{children}</Link>;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    case 'image': {
      const src = safeImageSrc(node.src);
      if (!src) return node.alt;
      return <img src={src} alt={node.alt} />;
    }
    default:
      return null;
  }
}

function alignStyle(align: 'left' | 'center' | 'right' | '' | undefined): CSSProperties | undefined {
  if (!align) return undefined;
  return { textAlign: align };
}
