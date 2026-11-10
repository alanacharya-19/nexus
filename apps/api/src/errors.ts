import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@nexus/shared';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export const Errors = {
  unauthorized: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (resource = 'Resource') =>
    new AppError(404, 'NOT_FOUND', `${resource} not found`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  validation: (message: string, details?: unknown) =>
    new AppError(400, 'VALIDATION_ERROR', message, { details }),
  invalidState: (message: string) => new AppError(409, 'INVALID_STATE', message),
  providerNotConfigured: (provider: string) =>
    new AppError(
      424,
      'PROVIDER_NOT_CONFIGURED',
      `No ${provider} API key is configured. Add a key in Settings → Providers.`
    ),
  providerFailed: (provider: string, message: string, details?: unknown) =>
    new AppError(502, 'PROVIDER_FAILED', `${provider}: ${message}`, { details }),
  aiInvalidOutput: (message: string, details?: unknown) =>
    new AppError(502, 'AI_INVALID_OUTPUT', message, { details }),
  rateLimited: (message = 'Too many requests. Try again shortly.') =>
    new AppError(429, 'RATE_LIMITED', message),
  serviceUnavailable: (message: string) =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};

export function toErrorBody(
  error: unknown,
  requestId: string | undefined
): { statusCode: number; body: ApiErrorBody } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Internal server error',
          details: error.expose ? error.details : undefined,
          requestId,
        },
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          requestId,
        },
      },
    };
  }

  const fastifyError = error as FastifyError;
  if (fastifyError?.statusCode && fastifyError.statusCode < 500) {
    return {
      statusCode: fastifyError.statusCode,
      body: {
        error: {
          code: fastifyError.code ?? 'REQUEST_ERROR',
          message: fastifyError.message,
          requestId,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. The request id is attached for support.',
        requestId,
      },
    },
  };
}

export function registerErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { statusCode, body } = toErrorBody(error, request.id);

  if (statusCode >= 500) {
    request.log.error({ err: error, requestId: request.id }, 'request failed');
  } else if (statusCode !== 401) {
    request.log.info(
      { code: body.error.code, requestId: request.id, statusCode },
      body.error.message
    );
  }

  if (reply.raw.headersSent) {
    reply.raw.end();
    return;
  }

  reply.status(statusCode).send(body);
}
