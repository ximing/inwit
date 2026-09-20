#!/usr/bin/env node
/**
 * Maintainer script: extract HTTP endpoints from Fastify route modules + @inwit/dto
 * into skills/inwit/references/. Not part of the agent-facing skill.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRootFromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referencesDir = path.join(repoRootFromScript, 'skills/inwit/references');

const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
const PARSE_RE = /(\w+Schema)\.parse\(\s*req\.(body|query|params)/g;
const CODE_RE = /reply\.code\((\d+)\)/g;
const LOCAL_SCHEMA_RE = /(?:export\s+)?const\s+(\w+Schema)\s*=\s*/g;

export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (
      existsSync(path.join(dir, 'packages/dto/package.json')) &&
      existsSync(path.join(dir, 'apps/server/src'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Not inside the inwit repo (need packages/dto and apps/server/src).');
    }
    dir = parent;
  }
}

function listFiles(dir, test) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...listFiles(full, test));
    } else if (test(entry.name, full)) {
      out.push(full);
    }
  }
  return out;
}

function latestMtime(files) {
  let max = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const t = statSync(file).mtimeMs;
    if (t > max) max = t;
  }
  return max;
}

function ensureDtoBuilt(repoRoot) {
  const dtoRoot = path.join(repoRoot, 'packages/dto');
  const dist = path.join(dtoRoot, 'dist/index.js');
  const srcFiles = listFiles(path.join(dtoRoot, 'src'), (name) => name.endsWith('.ts'));
  const distStale = !existsSync(dist) || latestMtime(srcFiles) > statSync(dist).mtimeMs;
  if (!distStale) return dist;
  execFileSync('pnpm', ['--filter', '@inwit/dto', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (!existsSync(dist)) {
    throw new Error('Failed to build @inwit/dto (packages/dto/dist/index.js missing).');
  }
  return dist;
}

function extractJsExpr(source, start) {
  let i = start;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let regex = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (regex) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '/') {
        regex = false;
      }
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && isRegexStart(source, i)) {
      regex = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === ';' && paren === 0 && brace === 0 && bracket === 0) {
      return source.slice(start, i).trim();
    }
    if (paren < 0 || brace < 0 || bracket < 0) break;
    i += 1;
  }
  return source.slice(start, i).trim();
}

function isRegexStart(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  return /[([{:;,=!&|?]$/.test(source[j]) || source.startsWith('return', Math.max(0, j - 5));
}

function extractLocalSchemas(source) {
  const map = new Map();
  LOCAL_SCHEMA_RE.lastIndex = 0;
  let match;
  while ((match = LOCAL_SCHEMA_RE.exec(source))) {
    map.set(match[1], extractJsExpr(source, match.index + match[0].length));
  }
  return map;
}

function precedingComment(source, index) {
  const before = source.slice(Math.max(0, index - 500), index);
  const match = before.match(/\/\*\*\s*([\s\S]*?)\*\/\s*$/);
  if (!match) return undefined;
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function detectAuth(snippet) {
  const head = snippet.slice(0, 400);
  if (/PAT_REQUIRED/.test(snippet) || /accessTokenId === undefined/.test(snippet)) {
    return 'pat';
  }
  if (
    /,\s*auth\s*,/.test(head) ||
    /\.\.\.auth/.test(head) ||
    /app\.authenticate/.test(head) ||
    /preHandler/.test(head)
  ) {
    return 'bearer';
  }
  return 'none';
}

function extractParses(snippet) {
  const found = { body: undefined, query: undefined, params: undefined };
  PARSE_RE.lastIndex = 0;
  let match;
  while ((match = PARSE_RE.exec(snippet))) {
    const slot = match[2];
    if (!found[slot]) found[slot] = match[1];
  }
  return found;
}

function extractRoutesFromSource(relFile, source) {
  const locals = extractLocalSchemas(source);
  const matches = [...source.matchAll(ROUTE_RE)];
  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const snippet = source.slice(start, end);
    const parses = extractParses(snippet);
    const status = uniqueSorted([...snippet.matchAll(CODE_RE)].map((m) => Number(m[1])));
    return {
      method: match[1].toUpperCase(),
      path: match[3],
      auth: detectAuth(snippet),
      file: relFile,
      status,
      comment: precedingComment(source, start),
      parses,
      locals,
    };
  });
}

function readDefault(def) {
  if (typeof def.defaultValue === 'function') return def.defaultValue();
  return def.defaultValue;
}

function peel(schema) {
  const flags = { optional: false, nullable: false, defaultValue: undefined, refinements: [] };
  let current = schema;
  const seen = new WeakSet();
  while (current && current._def && !seen.has(current)) {
    seen.add(current);
    const def = current._def;
    switch (def.typeName) {
      case 'ZodOptional':
      case 'ZodCatch':
        flags.optional = true;
        current = def.innerType;
        break;
      case 'ZodDefault':
        flags.optional = true;
        flags.defaultValue = readDefault(def);
        current = def.innerType;
        break;
      case 'ZodNullable':
        flags.nullable = true;
        current = def.innerType;
        break;
      case 'ZodEffects':
        if (def.effect?.type === 'refinement') flags.refinements.push(def.effect);
        current = def.schema;
        break;
      case 'ZodBranded':
      case 'ZodReadonly':
      case 'ZodPromise':
        current = def.innerType;
        break;
      case 'ZodPipeline':
        current = def.out ?? def.in;
        break;
      default:
        return { flags, core: current };
    }
  }
  return { flags, core: current };
}

function applyFlags(json, flags) {
  if (flags.optional) json.optional = true;
  if (flags.nullable) json.nullable = true;
  if (flags.defaultValue !== undefined) json.default = flags.defaultValue;
  if (flags.refinements.length > 0) json.refined = true;
  return json;
}

function stringFormat(def) {
  const checks = def.checks ?? [];
  if (checks.some((c) => c.kind === 'uuid')) return 'uuid';
  if (checks.some((c) => c.kind === 'email')) return 'email';
  if (checks.some((c) => c.kind === 'url')) return 'uri';
  if (checks.some((c) => c.kind === 'datetime')) return 'date-time';
  return undefined;
}

function zodToJson(schema, seen = new WeakSet()) {
  if (!schema || typeof schema !== 'object' || !schema._def) {
    return { description: 'unparsed' };
  }
  const { flags, core } = peel(schema);
  if (!core || typeof core !== 'object' || !core._def) {
    return applyFlags({ description: 'unparsed' }, flags);
  }
  if (seen.has(core)) return applyFlags({}, flags);
  seen.add(core);

  const def = core._def;
  const json = (() => {
    switch (def.typeName) {
    case 'ZodString': {
      const out = { type: 'string' };
      const format = stringFormat(def);
      if (format) out.format = format;
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minLength = check.value;
        if (check.kind === 'max') out.maxLength = check.value;
        if (check.kind === 'regex' && check.regex instanceof RegExp) {
          out.pattern = check.regex.source;
        }
      }
      return out;
    }
    case 'ZodNumber': {
      const out = { type: 'number' };
      if (def.coerce) out.coerced = true;
      for (const check of def.checks ?? []) {
        if (check.kind === 'int') out.type = 'integer';
        if (check.kind === 'min') {
          out.minimum = check.value;
          if (check.inclusive === false) out.exclusiveMinimum = true;
        }
        if (check.kind === 'max') {
          out.maximum = check.value;
          if (check.inclusive === false) out.exclusiveMaximum = true;
        }
      }
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral':
      return { const: def.value };
    case 'ZodEnum':
      return { type: 'string', enum: [...def.values] };
    case 'ZodNativeEnum': {
      const values = Object.values(def.values).filter((v) => typeof v === 'string' || typeof v === 'number');
      return { enum: values };
    }
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const properties = {};
      const required = [];
      for (const [key, value] of Object.entries(shape ?? {})) {
        const field = peel(value);
        properties[key] = zodToJson(value, seen);
        if (!field.flags.optional) required.push(key);
      }
      const out = { type: 'object', properties };
      if (required.length > 0) out.required = required;
      out.additionalProperties = def.unknownKeys === 'passthrough';
      return out;
    }
    case 'ZodArray': {
      const json = { type: 'array', items: zodToJson(def.type, seen) };
      if (typeof def.minLength?.value === 'number') json.minItems = def.minLength.value;
      if (typeof def.maxLength?.value === 'number') json.maxItems = def.maxLength.value;
      return json;
    }
    case 'ZodTuple':
      return {
        type: 'array',
        prefixItems: (def.items ?? []).map((item) => zodToJson(item, seen)),
      };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = def.options
        ? Array.isArray(def.options)
          ? def.options
          : [...def.options.values()]
        : [];
      return { anyOf: options.map((option) => zodToJson(option, seen)) };
    }
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodToJson(def.valueType, seen),
      };
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodUndefined':
    case 'ZodVoid':
    case 'ZodNever':
      return { not: {} };
    case 'ZodDate':
      return { type: 'string', format: 'date-time' };
    case 'ZodLazy':
      try {
        return zodToJson(def.getter(), seen);
      } catch {
        return {};
      }
    default:
      return { description: `zod:${def.typeName}` };
    }
  })();
  return applyFlags(json, flags);
}

function loadZod(repoRoot) {
  const requireFromDto = createRequire(path.join(repoRoot, 'packages/dto/package.json'));
  return requireFromDto('zod');
}

function compileLocal(z, expr) {
  if (!expr || !expr.startsWith('z.')) return undefined;
  try {
    return new Function('z', `"use strict"; return (${expr});`)(z);
  } catch {
    return undefined;
  }
}

function extractRefineMessages(expr) {
  if (!expr) return [];
  const out = [];
  const re = /\.refine\s*\([\s\S]*?message:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(expr))) out.push(match[1]);
  return out;
}

function attachConstraints(json, expr) {
  const constraints = extractRefineMessages(expr);
  if (!json) return json;
  if (constraints.length > 0) {
    json.constraints = constraints;
    delete json.refined;
  }
  return json;
}

function loadDtoSchemaSources(repoRoot) {
  const map = new Map();
  const dir = path.join(repoRoot, 'packages/dto/src');
  for (const file of listFiles(dir, (name) => name.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    const re = /export\s+const\s+(\w+Schema)\s*=\s*/g;
    let match;
    while ((match = re.exec(source))) {
      map.set(match[1], extractJsExpr(source, match.index + match[0].length));
    }
  }
  return map;
}

function resolveSchema(name, locals, dtoSchemas, z, dtoSources) {
  if (locals.has(name)) {
    const expr = locals.get(name);
    const compiled = compileLocal(z, expr);
    if (compiled) {
      return {
        name,
        origin: 'local',
        schema: attachConstraints(zodToJson(compiled), expr),
        source: expr,
      };
    }
    return { name, origin: 'local', source: expr };
  }
  const dto = dtoSchemas.get(name);
  if (dto) {
    return {
      name,
      origin: 'dto',
      schema: attachConstraints(zodToJson(dto), dtoSources.get(name)),
    };
  }
  return { name, origin: 'unknown' };
}

function pathGroup(apiPath) {
  if (apiPath === '/health') return 'health';
  const parts = apiPath.split('/').filter(Boolean);
  if (parts[0] !== 'api' || !parts[1]) return 'other';
  return parts[1];
}

/** Coarse modules for agent-facing markdown. Keep SKILL.md routing in sync. */
export const API_MODULES = [
  { id: 'open', title: '开放文档（PAT）', groups: ['open'] },
  { id: 'documents', title: '文档与问答', groups: ['documents', 'chat'] },
  { id: 'cards', title: '卡片', groups: ['cards', 'card-links'] },
  { id: 'review', title: '复习', groups: ['review'] },
  { id: 'topics', title: '主题与知识地图', groups: ['topics', 'topic-suggestions', 'map-nodes'] },
  { id: 'search', title: '搜索', groups: ['search'] },
  { id: 'jobs', title: '任务与周报', groups: ['jobs', 'reports', 'evolve'] },
  { id: 'annotations', title: '批注', groups: ['annotations', 'annotation-resurface'] },
  { id: 'assets', title: '媒体资源', groups: ['assets'] },
  { id: 'account', title: '账号与设置', groups: ['auth', 'me', 'llm-configs', 'ocr-config', 'health'] },
  { id: 'admin', title: '管理', groups: ['admin'] },
];

const GROUP_TO_MODULE = new Map(
  API_MODULES.flatMap((mod) => mod.groups.map((group) => [group, mod.id])),
);

export function moduleIdForPath(apiPath) {
  return GROUP_TO_MODULE.get(pathGroup(apiPath)) ?? 'other';
}

function compareEndpoints(a, b) {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return a.method.localeCompare(b.method);
}

function compactJson(value) {
  return JSON.stringify(value, null, 2);
}

function renderSlot(label, slot) {
  if (!slot) return '';
  const lines = [`- **${label}** \`${slot.name}\` (${slot.origin})`];
  if (slot.schema) {
    lines.push('```json', compactJson(slot.schema), '```');
  } else if (slot.source) {
    lines.push('```ts', slot.source, '```');
  }
  return `${lines.join('\n')}\n`;
}

function renderEndpoint(ep) {
  const lines = [];
  const bits = [];
  if (ep.auth !== 'none') bits.push(`auth=${ep.auth}`);
  if (ep.status.length > 0) bits.push(ep.status.join('/'));
  lines.push(`### ${ep.method} \`${ep.path}\``, '');
  if (bits.length > 0) lines.push(bits.join(' · '));
  if (ep.comment) lines.push('', ep.comment);
  lines.push('');
  if (ep.params) lines.push(renderSlot('params', ep.params));
  if (ep.query) lines.push(renderSlot('query', ep.query));
  if (ep.body) lines.push(renderSlot('body', ep.body));
  return lines.join('\n');
}

function renderModuleMarkdown(mod, endpoints, generatedAt) {
  const lines = [
    '<!-- Generated by scripts/generate-inwit-skill-api.mjs. Do not edit. -->',
    '',
    `# ${mod.title}`,
    '',
    `Generated ${generatedAt}. ${endpoints.length} endpoints.`,
    '',
  ];
  for (const ep of endpoints) {
    lines.push(renderEndpoint(ep), '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function renderIndexMarkdown(modules, generatedAt) {
  const lines = [
    '<!-- Generated by scripts/generate-inwit-skill-api.mjs. Do not edit. -->',
    '',
    '# API 模块索引',
    '',
    `Generated ${generatedAt}.`,
    '',
    '按意图只读其中一个文件。不要一次打开多个模块，也不要读 `api.json`。',
    '',
    '| 模块 | 文件 | 条数 |',
    '|---|---|---|',
  ];
  for (const mod of modules) {
    lines.push(`| ${mod.title} | [${mod.id}.md](./${mod.id}.md) | ${mod.count} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function clearGeneratedMarkdown(outDir) {
  if (!existsSync(outDir)) return;
  for (const name of readdirSync(outDir)) {
    if (name.endsWith('.md')) unlinkSync(path.join(outDir, name));
  }
}

export async function generateApi(opts = {}) {
  const repoRoot = opts.repoRoot ?? findRepoRoot(repoRootFromScript);
  const outDir = opts.outDir ?? referencesDir;
  const dist = ensureDtoBuilt(repoRoot);
  const dto = await import(pathToFileURL(dist).href);
  const z = loadZod(repoRoot);
  const dtoSchemas = new Map();
  for (const [name, value] of Object.entries(dto)) {
    if (value && typeof value === 'object' && value._def) dtoSchemas.set(name, value);
  }
  const dtoSources = loadDtoSchemaSources(repoRoot);

  const serverSrc = path.join(repoRoot, 'apps/server/src');
  const files = [
    ...listFiles(serverSrc, (name) => name.endsWith('.routes.ts')),
    path.join(serverSrc, 'app.ts'),
  ];

  const raw = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const source = readFileSync(file, 'utf8');
    raw.push(...extractRoutesFromSource(rel, source));
  }

  const endpoints = raw
    .map((route) => {
      const resolve = (name) =>
        name ? resolveSchema(name, route.locals, dtoSchemas, z, dtoSources) : undefined;
      return {
        method: route.method,
        path: route.path,
        module: moduleIdForPath(route.path),
        auth: route.auth,
        status: route.status,
        comment: route.comment,
        params: resolve(route.parses.params),
        query: resolve(route.parses.query),
        body: resolve(route.parses.body),
      };
    })
    .sort(compareEndpoints);

  const generatedAt = new Date().toISOString();
  const byModule = new Map();
  for (const ep of endpoints) {
    if (!byModule.has(ep.module)) byModule.set(ep.module, []);
    byModule.get(ep.module).push(ep);
  }

  const moduleSummaries = [];
  for (const spec of API_MODULES) {
    const items = byModule.get(spec.id) ?? [];
    if (items.length === 0) continue;
    moduleSummaries.push({ id: spec.id, title: spec.title, count: items.length });
  }
  for (const [id, items] of byModule) {
    if (API_MODULES.some((spec) => spec.id === id)) continue;
    moduleSummaries.push({ id, title: id, count: items.length });
  }

  const catalog = {
    generatedAt,
    modules: moduleSummaries,
    endpoints,
  };

  mkdirSync(outDir, { recursive: true });
  clearGeneratedMarkdown(outDir);
  const jsonPath = path.join(outDir, 'api.json');
  writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'index.md'), renderIndexMarkdown(moduleSummaries, generatedAt));
  const written = [jsonPath, path.join(outDir, 'index.md')];
  for (const spec of moduleSummaries) {
    const items = byModule.get(spec.id) ?? [];
    const mdPath = path.join(outDir, `${spec.id}.md`);
    writeFileSync(mdPath, renderModuleMarkdown(spec, items, generatedAt));
    written.push(mdPath);
  }
  return { catalog, jsonPath, written };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { catalog, written } = await generateApi();
  console.log(`Wrote ${catalog.endpoints.length} endpoints in ${catalog.modules.length} modules`);
  for (const file of written) console.log(file);
}
