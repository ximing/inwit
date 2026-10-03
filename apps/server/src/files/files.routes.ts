import { storageFilesQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { listStorageFiles } from './files.service.js';

export function registerFileRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  /** 当前账号对象存储里的文件，只读。 */
  app.get('/api/me/files', auth, async (req) => {
    const query = storageFilesQuerySchema.parse(req.query);
    return listStorageFiles(requireUser(req).id, query);
  });
}
