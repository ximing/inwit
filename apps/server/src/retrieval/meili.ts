import { ensure2xx, requestJson, RetrievalError } from './http.js';

export interface MeiliClientOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

export type MeiliFilter = string | Array<string | string[]>;

export interface MeiliClient {
  ensureIndex(uid: string): Promise<void>;
  upsertDocuments(uid: string, docs: Record<string, unknown>[]): Promise<void>;
  deleteDocuments(uid: string, ids: (string | number)[]): Promise<void>;
  search(
    uid: string,
    query: { q: string; filter?: MeiliFilter; limit?: number },
  ): Promise<Record<string, unknown>[]>;
}

const INDEX_SETTINGS = {
  filterableAttributes: ['user_id', 'card_id', 'tags', 'id'],
  searchableAttributes: ['concept', 'example', 'confusion_point', 'tags', 'text'],
  localizedAttributes: [{ attributePatterns: ['*'], locales: ['cmn'] }],
} as const;

const TASK_TIMEOUT_MS = 30_000;

function asHits(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((item) =>
    typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {},
  );
}

function taskUidOf(json: unknown): number | null {
  if (typeof json !== 'object' || json === null) return null;
  const uid = (json as { taskUid?: unknown }).taskUid;
  return typeof uid === 'number' ? uid : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Thin Meilisearch REST wrapper. Write operations wait until the task succeeds. */
export function createMeiliClient(options: MeiliClientOptions): MeiliClient {
  const base = options.url.replace(/\/$/, '');

  function headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` };
  }

  function call(method: string, path: string, body?: unknown) {
    return requestJson(method, `${base}${path}`, {
      timeoutMs: options.timeoutMs,
      headers: headers(),
      body,
    });
  }

  async function waitForTask(taskUid: number): Promise<void> {
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    for (;;) {
      const res = await call('GET', `/tasks/${String(taskUid)}`);
      ensure2xx(res, 'meili task');
      const body = res.json as { status?: unknown; error?: { message?: unknown } };
      if (body.status === 'succeeded') return;
      if (body.status === 'failed') {
        const message = typeof body.error?.message === 'string' ? body.error.message : 'meili task failed';
        throw new RetrievalError('BAD_RESPONSE', message);
      }
      if (Date.now() >= deadline) {
        throw new RetrievalError('TIMEOUT', `meili task ${String(taskUid)} timed out`);
      }
      await sleep(150);
    }
  }

  async function submitAndWait(method: string, path: string, what: string, body?: unknown): Promise<void> {
    const res = await call(method, path, body);
    ensure2xx(res, what);
    const uid = taskUidOf(res.json);
    if (uid !== null) await waitForTask(uid);
  }

  return {
    async ensureIndex(uid) {
      const existing = await call('GET', `/indexes/${uid}`);
      if (existing.status === 404) {
        await submitAndWait('POST', '/indexes', 'meili create index', { uid, primaryKey: 'id' });
      } else {
        ensure2xx(existing, 'meili get index');
        const primaryKey = (existing.json as { primaryKey?: unknown }).primaryKey;
        if (primaryKey === null || primaryKey === undefined) {
          await submitAndWait('PATCH', `/indexes/${uid}`, 'meili set primary key', { primaryKey: 'id' });
        }
      }
      await submitAndWait('PATCH', `/indexes/${uid}/settings`, 'meili settings', INDEX_SETTINGS);
    },

    async upsertDocuments(uid, docs) {
      if (docs.length === 0) return;
      await submitAndWait(
        'POST',
        `/indexes/${uid}/documents?primaryKey=id`,
        'meili upsert documents',
        docs,
      );
    },

    async deleteDocuments(uid, ids) {
      if (ids.length === 0) return;
      const quoted = ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(', ');
      await submitAndWait(
        'POST',
        `/indexes/${uid}/documents/delete`,
        'meili delete documents',
        { filter: `id IN [${quoted}]` },
      );
    },

    async search(uid, query) {
      const res = await call('POST', `/indexes/${uid}/search`, {
        q: query.q,
        filter: query.filter,
        limit: query.limit,
      });
      ensure2xx(res, 'meili search');
      return asHits((res.json as { hits?: unknown }).hits);
    },
  };
}
