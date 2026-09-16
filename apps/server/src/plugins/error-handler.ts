import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ERROR_MESSAGES } from '../errors.js';

function send(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const error = details !== undefined ? { code, message, details } : { code, message };
  void reply.status(status).send({ error });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError || error.name === 'ZodError') {
      const issues = error instanceof ZodError ? error.issues : undefined;
      send(reply, 400, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR, issues);
      return;
    }
    if (error instanceof AppError) {
      send(reply, error.status, error.code, error.message, error.details);
      return;
    }
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    const code = 'code' in error ? error.code : undefined;
    if (
      statusCode === 413 ||
      code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
      code === 'FST_REQ_FILE_TOO_LARGE'
    ) {
      send(reply, 413, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR);
      return;
    }
    if (statusCode === 400 || error.name === 'FastifyError') {
      if (code === 'FST_ERR_CTP_INVALID_JSON' || code === 'FST_ERR_VALIDATION') {
        send(reply, 400, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
    }
    req.log.error(error);
    send(reply, 500, 'INTERNAL_ERROR', ERROR_MESSAGES.INTERNAL_ERROR);
  });

  app.setNotFoundHandler((_req, reply) => {
    send(reply, 404, 'NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
  });
}
