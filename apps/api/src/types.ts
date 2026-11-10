import type { User } from '@nexus/shared';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: User;
    authKind: 'local' | 'supabase';
  }
}

export {};
