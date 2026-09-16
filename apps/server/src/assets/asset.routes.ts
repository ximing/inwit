import {
  assetMultipartCompleteInputSchema,
  assetMultipartInitInputSchema,
  assetMultipartSignInputSchema,
  assetResolveInputSchema,
  assetUploadInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import {
  completeAssetMultipart,
  initAssetMultipart,
  requestAssetUpload,
  resolveAssetUrls,
  signAssetMultipartParts,
} from './asset.service.js';

export function registerAssetRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post('/api/assets/presign', auth, async (req) => {
    const input = assetUploadInputSchema.parse(req.body);
    return requestAssetUpload(requireUser(req).id, input);
  });

  app.post('/api/assets/resolve', auth, async (req) => {
    const input = assetResolveInputSchema.parse(req.body);
    return resolveAssetUrls(requireUser(req).id, input.srcs);
  });

  app.post('/api/assets/multipart/init', auth, async (req) => {
    const input = assetMultipartInitInputSchema.parse(req.body);
    return initAssetMultipart(requireUser(req).id, input);
  });

  app.post('/api/assets/multipart/sign', auth, async (req) => {
    const input = assetMultipartSignInputSchema.parse(req.body);
    return signAssetMultipartParts(requireUser(req).id, input);
  });

  app.post('/api/assets/multipart/complete', auth, async (req) => {
    const input = assetMultipartCompleteInputSchema.parse(req.body);
    return completeAssetMultipart(requireUser(req).id, input);
  });
}
