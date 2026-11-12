import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { Errors } from '../errors.js';
import { seedDefaultAgents } from '../repositories/agents.js';
import { upsertUser } from '../repositories/users.js';
import type { User } from '@nexus/shared';

const LOCAL_ISSUER = 'nexus-api';
const LOCAL_AUDIENCE = 'nexus-mobile';
const STREAM_AUDIENCE = 'nexus-stream';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwksSet() {
  if (!jwks) {
    if (!config.supabaseUrl) throw Errors.unauthorized('Supabase auth is not configured');
    jwks = createRemoteJWKSet(
      new URL(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`)
    );
  }
  return jwks;
}

export async function bootstrapUser(identity: {
  sub: string;
  email: string;
  name?: string | null;
}): Promise<User> {
  const user = await upsertUser({
    id: identity.sub,
    email: identity.email,
    name: identity.name ?? null,
  });
  await seedDefaultAgents(user.id);
  return user;
}

export async function signLocalToken(user: User): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(LOCAL_ISSUER)
    .setAudience(LOCAL_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(config.devJwtSecret));
}

export async function signStreamToken(userId: string, runId: string): Promise<string> {
  return new SignJWT({ runId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(LOCAL_ISSUER)
    .setAudience(STREAM_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(config.devJwtSecret));
}

async function verifyLocalToken(token: string): Promise<{ payload: JWTPayload; user: User }> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(config.devJwtSecret), {
    issuer: LOCAL_ISSUER,
    audience: LOCAL_AUDIENCE,
  });
  if (!payload.sub || typeof payload.email !== 'string') {
    throw Errors.unauthorized('Invalid local session');
  }
  const user = await bootstrapUser({
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : null,
  });
  return { payload, user };
}

async function verifySupabaseToken(token: string): Promise<{ payload: JWTPayload; user: User }> {
  if (!config.supabaseUrl) {
    throw Errors.unauthorized('Supabase auth is not configured on this server');
  }
  const issuer = `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`;

  let payload: JWTPayload;
  if (config.supabaseJwtSecret) {
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode(config.supabaseJwtSecret),
      { audience: 'authenticated', issuer }
    );
    payload = verified.payload;
  } else {
    const verified = await jwtVerify(token, jwksSet(), {
      audience: 'authenticated',
      issuer,
    });
    payload = verified.payload;
  }

  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof (payload.user_metadata as Record<string, unknown> | undefined)?.email === 'string'
        ? String((payload.user_metadata as Record<string, unknown>).email)
        : null;

  if (!payload.sub || !email) {
    throw Errors.unauthorized('Supabase token is missing an email claim');
  }

  const metadata = payload.user_metadata as Record<string, unknown> | undefined;
  const user = await bootstrapUser({
    sub: payload.sub,
    email,
    name: typeof metadata?.full_name === 'string' ? metadata.full_name : null,
  });
  return { payload, user };
}

export async function authenticateToken(
  token: string
): Promise<{ user: User; kind: 'local' | 'supabase' }> {
  try {
    // Local tokens are always HS256 and issued by us. Decode the payload first
    // to choose the verifier without trusting the signature yet.
    const [, payloadPart] = token.split('.');
    if (!payloadPart) throw Errors.unauthorized('Malformed token');
    const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      iss?: string;
    };

    if (decoded.iss === LOCAL_ISSUER) {
      const { user } = await verifyLocalToken(token);
      return { user, kind: 'local' };
    }
    const { user } = await verifySupabaseToken(token);
    return { user, kind: 'supabase' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw Errors.unauthorized('Your session is invalid or has expired. Sign in again.');
  }
}

export async function verifyStreamToken(
  token: string,
  runId: string
): Promise<{ userId: string }> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(config.devJwtSecret),
      { issuer: LOCAL_ISSUER, audience: STREAM_AUDIENCE }
    );
    if (!payload.sub || payload.runId !== runId) {
      throw Errors.unauthorized('Stream token does not match this run');
    }
    return { userId: payload.sub };
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw Errors.unauthorized('Stream token is invalid or has expired');
  }
}

export async function signConversationStreamToken(
  userId: string,
  conversationId: string
): Promise<string> {
  return new SignJWT({ conversationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(LOCAL_ISSUER)
    .setAudience(STREAM_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(config.devJwtSecret));
}

export async function verifyConversationStreamToken(
  token: string,
  conversationId: string
): Promise<{ userId: string }> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(config.devJwtSecret),
      { issuer: LOCAL_ISSUER, audience: STREAM_AUDIENCE }
    );
    if (!payload.sub || payload.conversationId !== conversationId) {
      throw Errors.unauthorized('Stream token does not match this conversation');
    }
    return { userId: payload.sub };
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw Errors.unauthorized('Stream token is invalid or has expired');
  }
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
