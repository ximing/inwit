import { updateTranslationSettingsSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { getDb } from '../db/index.js';
import {
  deleteTranslationSettings,
  getTranslationSettings,
  readTranslationCredential,
  saveTranslationSettings,
  snapshotTranslationModel,
} from './translation-settings.service.js';
import { completeTranslation } from './translation-call.js';
import { logTranslationUsage } from './translation-usage.js';
export function registerTranslationSettingsRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };
  app.get('/api/settings/translation', auth, (req) => getTranslationSettings(requireUser(req).id));
  app.put('/api/settings/translation', auth, (req) =>
    saveTranslationSettings(requireUser(req).id, updateTranslationSettingsSchema.parse(req.body)),
  );
  app.delete('/api/settings/translation', auth, async (req, reply) => {
    await deleteTranslationSettings(requireUser(req).id);
    return reply.code(204).send();
  });
  app.post('/api/settings/translation/test', auth, async (req) => {
    const userId = requireUser(req).id;
    const { snapshot, key } = await getDb().transaction(async (tx) => {
      const snapshot = await snapshotTranslationModel(tx, userId);
      return {
        snapshot,
        key: await readTranslationCredential(tx, userId, snapshot.credentialVersionId),
      };
    });
    const result = await completeTranslation(
      snapshot,
      key,
      'The experiment did not improve accuracy.',
    );
    await logTranslationUsage(userId, snapshot, result);
    return {
      ok: result.status === 'succeeded',
      errorCode: result.errorCode ?? null,
      usage: {
        usageStatus: result.usageStatus,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
    };
  });
}
