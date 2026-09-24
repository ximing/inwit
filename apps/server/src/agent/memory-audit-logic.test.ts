import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LOAD_MEMORY_COLLECTION_TOOL,
  SEARCH_MEMORY_COLLECTIONS_TOOL,
  auditMemoryToolPayload,
  isMemoryAuditTool,
} from './memory-audit-logic.js';

const SECRET_QUERY = 'SECRET_QUERY_材料在讲梯度🙂';
const SECRET_TITLE = 'SECRET_TITLE_切卡粒度';
const SECRET_DESC = 'SECRET_DESC_要例子不要只写定义';
const SECRET_BODY = 'SECRET_BODY_用户喜欢对照旧卡🙂';

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe('auditMemoryToolPayload', () => {
  it('keeps query length and collection ids, not the query text', () => {
    expect(isMemoryAuditTool(SEARCH_MEMORY_COLLECTIONS_TOOL)).toBe(true);
    expect(isMemoryAuditTool(LOAD_MEMORY_COLLECTION_TOOL)).toBe(true);
    expect(isMemoryAuditTool('search_user_memories')).toBe(false);

    const searchArgs = auditMemoryToolPayload(
      SEARCH_MEMORY_COLLECTIONS_TOOL,
      { query: SECRET_QUERY, note: SECRET_BODY },
      'args',
    );
    expect(searchArgs).toEqual({
      tool: SEARCH_MEMORY_COLLECTIONS_TOOL,
      queryChars: [...SECRET_QUERY].length,
    });
    expect([...SECRET_QUERY].length).toBe(SECRET_QUERY.length - 1);
    expect(json(searchArgs)).not.toContain('SECRET_');

    const loadArgs = auditMemoryToolPayload(
      LOAD_MEMORY_COLLECTION_TOOL,
      { query: '🙂', collectionIds: ['c1', 2, '', 'c2'], note: SECRET_DESC },
      'args',
    );
    expect(loadArgs).toEqual({
      tool: LOAD_MEMORY_COLLECTION_TOOL,
      queryChars: 1,
      collectionIds: ['c1', 'c2'],
    });
    expect(json(loadArgs)).not.toContain('SECRET_');
  });

  it('projects search hits to id, score, and description length', () => {
    const details = {
      collections: [
        { id: 'c1', title: SECRET_TITLE, description: SECRET_DESC, score: 0.5 },
        { id: 'c2', title: '易混', description: '🙂', score: null },
        { id: '', title: SECRET_TITLE, description: SECRET_DESC, score: 1 },
      ],
    };
    const wrapped = {
      content: [
        {
          type: 'text',
          text: json({ collections: [{ id: 'c1', description: 'LEAK_ONLY_IN_TEXT', score: 0 }] }),
        },
      ],
      details,
    };
    expect(auditMemoryToolPayload(SEARCH_MEMORY_COLLECTIONS_TOOL, wrapped, 'result')).toEqual({
      tool: SEARCH_MEMORY_COLLECTIONS_TOOL,
      count: 2,
      collections: [
        { id: 'c1', score: 0.5, descriptionChars: [...SECRET_DESC].length },
        { id: 'c2', score: null, descriptionChars: 1 },
      ],
    });
    const text = json(auditMemoryToolPayload(SEARCH_MEMORY_COLLECTIONS_TOOL, wrapped, 'result'));
    expect(text).not.toContain(SECRET_DESC);
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain('LEAK_ONLY_IN_TEXT');

    const fromText = {
      content: [{ type: 'text', text: json(details) }],
      details: {},
    };
    expect(
      auditMemoryToolPayload(SEARCH_MEMORY_COLLECTIONS_TOOL, fromText, 'result'),
    ).toMatchObject({ count: 2 });
    expect(json(auditMemoryToolPayload(SEARCH_MEMORY_COLLECTIONS_TOOL, fromText, 'result'))).not.toContain(
      SECRET_DESC,
    );

    expect(
      auditMemoryToolPayload(
        SEARCH_MEMORY_COLLECTIONS_TOOL,
        { content: [{ type: 'text', text: '[]' }], details: [] },
        'result',
      ),
    ).toEqual({ tool: SEARCH_MEMORY_COLLECTIONS_TOOL, count: 0, collections: [] });

    expect(
      auditMemoryToolPayload(
        SEARCH_MEMORY_COLLECTIONS_TOOL,
        { id: 'c1', description: '', score: Number.NaN },
        'result',
      ),
    ).toEqual({ tool: SEARCH_MEMORY_COLLECTIONS_TOOL, count: 0, collections: [] });
  });

  it('projects loaded entries to ids and body length', () => {
    const details = {
      collections: [
        {
          id: 'c1',
          title: SECRET_TITLE,
          description: SECRET_DESC,
          truncated: true,
          entries: [
            { id: 'e1', body: SECRET_BODY },
            { id: 'e2', body: '🙂' },
          ],
        },
      ],
    };
    const projected = auditMemoryToolPayload(
      LOAD_MEMORY_COLLECTION_TOOL,
      {
        content: [{ type: 'text', text: json(details) }],
        details,
      },
      'result',
    );
    expect(projected).toEqual({
      tool: LOAD_MEMORY_COLLECTION_TOOL,
      count: 1,
      collections: [
        {
          id: 'c1',
          truncated: true,
          entries: [
            { id: 'e1', bodyChars: [...SECRET_BODY].length },
            { id: 'e2', bodyChars: 1 },
          ],
        },
      ],
    });
    const text = json(projected);
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain(SECRET_DESC);
    expect([...SECRET_BODY].length).toBe(SECRET_BODY.length - 1);
  });

  it('drops error text for memory tools and leaves other tools unchanged', () => {
    const leaked = {
      content: [{ type: 'text', text: SECRET_BODY }],
      details: { description: SECRET_DESC },
    };
    expect(
      auditMemoryToolPayload(LOAD_MEMORY_COLLECTION_TOOL, leaked, 'result', true),
    ).toEqual({ tool: LOAD_MEMORY_COLLECTION_TOOL, error: true });
    expect(json(auditMemoryToolPayload(SEARCH_MEMORY_COLLECTIONS_TOOL, SECRET_DESC, 'result'))).not.toContain(
      'SECRET_',
    );

    const card = { concept: SECRET_BODY, example: SECRET_DESC };
    expect(auditMemoryToolPayload('search_user_memories', card, 'result')).toBe(card);
    expect(auditMemoryToolPayload('write_cards', card, 'args', true)).toBe(card);
  });
});

describe('memory audit wiring', () => {
  it('projects memory tools before summarizeValue and does not raise the global turn cap', () => {
    const source = readFileSync(new URL('./run-agent-job.ts', import.meta.url), 'utf8');
    expect(source).toContain('const DEFAULT_MAX_TURNS = 24;');
    const end = source.indexOf("event.type === 'tool_execution_end'");
    const block = source.slice(end, source.indexOf('saveExecutionSteps', end));
    const projectAt = block.indexOf('auditMemoryToolPayload');
    const summarizeAt = block.lastIndexOf('summarizeValue');
    expect(projectAt).toBeGreaterThan(-1);
    expect(summarizeAt).toBeGreaterThan(projectAt);
    expect(block).not.toContain('summarizeValue(event.result)');
    expect(block).not.toContain('summarizeValue(started?.args)');
    expect(block).toContain('measureValue(event.result)');

    const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    expect(read('digest.ts')).toContain('maxTurns: 72');
    expect(read('chat.ts')).toContain('maxTurns: 32');
    expect(read('evolve.ts')).toContain('maxTurns: 32');
    expect(read('analyze.ts')).toContain('maxTurns: 40');
    expect(read('tools.ts')).toContain('...memoryLoadTools(session)');
    expect(read('evolve-tools.ts')).toContain('...memoryLoadTools(session)');
    expect(read('analyze-tools.ts')).toContain('...memoryLoadTools(session)');
    expect(read('weekly-tools.ts')).not.toContain('memoryLoadTools');
    expect(read('topic-tools.ts')).not.toContain('memoryLoadTools');
    expect(read('suggest-tools.ts')).not.toContain('memoryLoadTools');
  });
});
