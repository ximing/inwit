import { ensure2xx, requestJson } from './http.js';

export interface QdrantClientOptions {
  url: string;
  apiKey?: string | undefined;
  vectorSize: number;
  timeoutMs?: number;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QdrantScoredPoint {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantClient {
  ensureCollection(name: string): Promise<void>;
  upsertPoints(name: string, points: QdrantPoint[]): Promise<void>;
  queryPoints(
    name: string,
    vector: number[],
    filter: unknown,
    limit: number,
  ): Promise<QdrantScoredPoint[]>;
  deletePoints(name: string, ids: (string | number)[]): Promise<void>;
}

const PAYLOAD_INDEX_FIELDS = ['user_id', 'card_id'] as const;

function asPayload(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Thin Qdrant REST wrapper. Ids/payloads pass through untouched. */
export function createQdrantClient(options: QdrantClientOptions): QdrantClient {
  const base = options.url.replace(/\/$/, '');

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey) h['api-key'] = options.apiKey;
    return h;
  }

  function call(method: string, path: string, body?: unknown) {
    return requestJson(method, `${base}${path}`, {
      timeoutMs: options.timeoutMs,
      headers: headers(),
      body,
    });
  }

  return {
    async ensureCollection(name) {
      const existing = await call('GET', `/collections/${name}`);
      if (existing.status === 404) {
        ensure2xx(
          await call('PUT', `/collections/${name}`, {
            vectors: { size: options.vectorSize, distance: 'Cosine' },
          }),
          'qdrant create collection',
        );
      } else {
        ensure2xx(existing, 'qdrant get collection');
      }
      for (const field of PAYLOAD_INDEX_FIELDS) {
        const res = await call('PUT', `/collections/${name}/index`, {
          field_name: field,
          field_schema: 'keyword',
        });
        if (res.status === 409) continue;
        ensure2xx(res, 'qdrant create payload index');
      }
    },

    async upsertPoints(name, points) {
      if (points.length === 0) return;
      ensure2xx(
        await call('PUT', `/collections/${name}/points?wait=true`, { points }),
        'qdrant upsert points',
      );
    },

    async queryPoints(name, vector, filter, limit) {
      const res = await call('POST', `/collections/${name}/points/query`, {
        query: vector,
        filter,
        limit,
        with_payload: true,
      });
      ensure2xx(res, 'qdrant query points');
      const result = (res.json as { result?: { points?: unknown } }).result;
      const rows = Array.isArray(result?.points) ? (result.points as unknown[]) : [];
      return rows.map((item) => {
        const record = item as { id?: unknown; score?: unknown; payload?: unknown };
        return {
          id: typeof record.id === 'number' ? record.id : String(record.id),
          score: typeof record.score === 'number' ? record.score : 0,
          payload: asPayload(record.payload),
        };
      });
    },

    async deletePoints(name, ids) {
      if (ids.length === 0) return;
      ensure2xx(
        await call('POST', `/collections/${name}/points/delete?wait=true`, {
          points: ids,
        }),
        'qdrant delete points',
      );
    },
  };
}
