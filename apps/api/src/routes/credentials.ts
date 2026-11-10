import type { FastifyPluginAsync } from 'fastify';
import { credentialSchema, providerSchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  getCredentialStatuses,
  removeUserCredential,
  saveUserCredential,
  validateProviderKey,
} from '../providers/service.js';

export const credentialRoutes: FastifyPluginAsync = async (app) => {
  app.get('/credentials', { preHandler: requireAuth }, async (request) => {
    const credentials = await getCredentialStatuses(request.authUser.id);
    return { credentials };
  });

  app.put('/credentials/:provider', { preHandler: requireAuth }, async (request) => {
    const provider = providerSchema.safeParse(
      (request.params as { provider: string }).provider
    );
    if (!provider.success) throw Errors.validation('Unknown provider');
    const input = credentialSchema.parse(request.body ?? {});
    const status = await saveUserCredential(
      request.authUser.id,
      provider.data,
      input.apiKey
    );
    return { credential: status };
  });

  app.post('/credentials/:provider/test', { preHandler: requireAuth }, async (request) => {
    const provider = providerSchema.safeParse(
      (request.params as { provider: string }).provider
    );
    if (!provider.success) throw Errors.validation('Unknown provider');
    const input = credentialSchema.parse(request.body ?? {});
    const result = await validateProviderKey(provider.data, input.apiKey);
    return result;
  });

  app.delete('/credentials/:provider', { preHandler: requireAuth }, async (request) => {
    const provider = providerSchema.safeParse(
      (request.params as { provider: string }).provider
    );
    if (!provider.success) throw Errors.validation('Unknown provider');
    await removeUserCredential(request.authUser.id, provider.data);
    return { deleted: true };
  });
};
