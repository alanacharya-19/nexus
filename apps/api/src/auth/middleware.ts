import type { FastifyRequest } from 'fastify';
import { authenticateToken, extractBearer } from './auth.js';
import { Errors } from '../errors.js';

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = extractBearer(request.headers.authorization);
  if (!token) throw Errors.unauthorized();
  const { user, kind } = await authenticateToken(token);
  request.authUser = user;
  request.authKind = kind;
}
