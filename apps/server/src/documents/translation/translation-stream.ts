import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { translationJobParamsSchema } from '@inwit/dto';
import { AppError } from '../../errors.js';
import { pool } from '../../db/index.js';
import { requireUser, streamPrincipal } from '../../auth/authenticate.js';
import { getTranslationJob } from './translation.service.js';

/** NOTIFY is only a wakeup. Database snapshots, not notification delivery, are authoritative. */
export function registerTranslationStream(app: FastifyInstance) {
  const listeners = new Map<string, Set<() => void>>();
  const connections = new Set<PassThrough>();
  let client: PoolClient | undefined;
  let connecting: Promise<void> | undefined;
  let discardListener: (() => void) | undefined;
  let stopped = false;
  const ensureListener = () => {
    if (client || connecting || stopped) return;
    connecting = (async () => {
      const next = await pool.connect();
      if (stopped) {
        next.release();
        return;
      }
      next.on('notification', (event) => {
        if (event.channel !== 'pdf_translation_changed' || !event.payload) return;
        try {
          const data = JSON.parse(event.payload) as { userId: string; jobId: string };
          for (const wake of listeners.get(`${data.userId}:${data.jobId}`) ?? []) wake();
        } catch {
          /* Foreign/malformed notifications never become response content. */
        }
      });
      let released = false;
      const discard = () => {
        if (client === next) client = undefined;
        if (!released) {
          released = true;
          next.release(true);
        }
      };
      next.once('error', discard);
      try {
        await next.query('LISTEN pdf_translation_changed');
        if (!released) {
          client = next;
          discardListener = discard;
        }
      } catch {
        discard();
      }
    })()
      .catch(() => {})
      .finally(() => {
        connecting = undefined;
      });
  };
  app.addHook('preClose', async () => {
    stopped = true;
    for (const connection of connections) connection.destroy();
  });
  app.addHook('onClose', async () => {
    await connecting;
    if (client) {
      client.removeAllListeners('notification');
      await client.query('UNLISTEN pdf_translation_changed').catch(() => {});
      discardListener?.();
      discardListener = undefined;
    }
  });
  app.get(
    '/api/documents/:id/translation-jobs/:jobId/stream',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, jobId } = translationJobParamsSchema.parse(req.params);
      const userId = requireUser(req).id;
      // Fail with ordinary HTTP status before any streaming headers are sent.
      await getTranslationJob(userId, id, jobId);
      const output = new PassThrough({ highWaterMark: 64 * 1024 });
      connections.add(output);
      let closed = false,
        reading = false,
        again = false,
        blocked = false;
      let previous = '';
      const key = `${userId}:${jobId}`;
      const fail = (code: string) => {
        if (!closed) {
          output.end(`event: error\ndata: ${JSON.stringify({ code })}\n\n`);
          cleanup();
        }
      };
      const refresh = async () => {
        if (closed) return;
        ensureListener();
        if (reading || blocked) {
          again = true;
          return;
        }
        reading = true;
        try {
          const principal = await streamPrincipal(req);
          if (!principal || principal.id !== userId) {
            fail('AUTH_EXPIRED');
            return;
          }
          const snapshot = await getTranslationJob(userId, id, jobId);
          if (closed) return;
          const data = JSON.stringify(snapshot);
          if (data !== previous) {
            previous = data;
            blocked = !output.write(
              `event: snapshot\nid: ${snapshot.draft?.seq ?? '0'}\ndata: ${data}\n\n`,
            );
          }
          if (!['queued', 'preparing', 'dispatched'].includes(snapshot.state)) {
            output.end();
            cleanup();
          }
        } catch (error) {
          fail(
            error instanceof AppError && [403, 404, 409].includes(error.status)
              ? 'RESOURCE_UNAVAILABLE'
              : 'STREAM_UNAVAILABLE',
          );
        } finally {
          reading = false;
          if (again && !blocked && !closed) {
            again = false;
            void refresh();
          }
        }
      };
      const wake = () => {
        void refresh();
      };
      const group = listeners.get(key) ?? new Set<() => void>();
      group.add(wake);
      listeners.set(key, group);
      // Poll repairs dropped NOTIFY/LISTEN reconnects and detects revocation/deletion without events.
      const reconcile = setInterval(wake, 1500);
      const heartbeat = setInterval(() => {
        if (!blocked && !closed) blocked = !output.write(': heartbeat\n\n');
      }, 15000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(reconcile);
        clearInterval(heartbeat);
        group.delete(wake);
        if (!group.size) listeners.delete(key);
        connections.delete(output);
      };
      output.on('drain', () => {
        blocked = false;
        again = false;
        wake();
      });
      output.on('close', cleanup);
      reply.raw.on('close', () => {
        cleanup();
        output.destroy();
      });
      reply
        .header('Content-Type', 'text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no');
      ensureListener();
      void refresh();
      return reply.send(output);
    },
  );
}
