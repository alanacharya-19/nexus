# NEXUS

NEXUS is a premium multi-agent AI collaboration workspace for mobile. You give it an
objective; a pipeline of specialist agents plans, executes, reviews, revises, and polishes
real deliverables. Every step is streamed live, persisted, and replayable.

- **Mobile** — Expo / React Native / TypeScript / Expo Router
- **API** — Node / Fastify / PostgreSQL / Server-Sent Events
- **Shared** — one TypeScript package of domain types, schemas, and model metadata

```
apps/
  mobile/    Expo app (iOS, Android, web)
  api/       Fastify API + orchestration engine
packages/
  shared/    Domain types, Zod schemas, model registry, prompts
```

## How it works

A run moves through a fixed pipeline:

```
plan → work → review → revise (if needed) → polish → deliver
```

1. **Planner** decomposes the objective into an ordered, artifact-producing plan.
2. **Workers** execute the steps and write the actual deliverables.
3. **Reviewer** audits accuracy, completeness, and risk, and can require changes.
4. **Revise** re-runs the affected work when the review demands it.
5. **Polisher** produces the final deliverable.
6. **Deliver** marks the run complete and exposes the final artifact.

Runs can pause, resume, cancel, retry, accept steering instructions, and stop for human
approval. Approval modes: `always` (every stage), `key` (plan & review), `auto`.

Providers are independent adapters (OpenAI, Anthropic, Google). Model output is validated
against Zod schemas with one repair attempt, and provider retries/fallbacks happen before
text is emitted to the client.

## Requirements

- Node.js 20+ (tested on 26)
- npm 10+
- PostgreSQL 14+ (Docker Compose file included)
- Expo Go, an iOS/Android simulator, or a browser for the mobile app

## Setup

```bash
# 1. Install every workspace
npm install

# 2. Create your env file
cp .env.example .env
#    Edit .env — at minimum set a real CREDENTIAL_ENCRYPTION_KEY

# 3. Start PostgreSQL
docker compose up -d

# 4. Apply the schema
npm run db:migrate

# 5. Start the API (builds shared first)
npm run dev:api

# 6. In another terminal, start the mobile app
npm start          # then press i / a / w, or scan the QR code
```

The API listens on `http://localhost:4000`. The mobile app auto-detects the API host from
Expo's `hostUri`; set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to override it.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | `true` for hosted Postgres such as Supabase |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM key for provider credentials (required in production) |
| `ALLOW_DEV_AUTH` | Enables local email sign-in for development |
| `DEV_AUTH_ALLOWLIST` | Optional comma-separated emails allowed to use dev auth |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Enables Supabase email/password sign-in |
| `SUPABASE_JWT_SECRET` | HS256 verification; leave blank to use Supabase JWKS |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | Optional server-side provider keys |
| `MAX_CONCURRENT_RUNS` | Orchestration concurrency limit |
| `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RETRIES` | Provider call limits |
| `CORS_ORIGINS` | Comma-separated allowed origins (`*` in development) |
| `EXPO_PUBLIC_API_URL` | Mobile override for the API base URL |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile Supabase sign-in |

Provider keys can also be added per user from **Settings → Provider credentials**. User
keys are encrypted with AES-256-GCM at rest, take precedence over server keys, and are
never returned to the client.

## Scripts

Run from the repository root:

```bash
npm run dev:api     # API in watch mode (builds shared)
npm start           # Expo dev server
npm run ios         # Expo on iOS
npm run android     # Expo on Android
npm run web         # Expo in the browser
npm run db:migrate  # Apply SQL migrations
npm run typecheck   # shared + api + mobile
npm test            # API unit tests
npm run lint        # mobile + api ESLint
npm run build:shared
```

## API surface

Base path `/v1`. Authenticated routes expect `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + database status |
| `GET` | `/v1/capabilities` | Auth modes, providers, limits |
| `POST` | `/v1/auth/dev` | Local development sign-in |
| `GET` | `/v1/auth/me` | Current user |
| `GET` | `/v1/models` | Model catalog with pricing |
| `GET/POST` | `/v1/agents` | List / create agents |
| `PATCH/DELETE` | `/v1/agents/:id` | Update / delete an agent |
| `GET/POST` | `/v1/projects` | Projects |
| `GET` | `/v1/templates` | Built-in workflow templates |
| `GET/POST` | `/v1/runs` | List / create runs |
| `GET` | `/v1/runs/:id` | Run detail, plan, review, artifacts |
| `POST` | `/v1/runs/:id/actions` | start, pause, resume, cancel, retry |
| `POST` | `/v1/runs/:id/approval` | Approve or request changes |
| `POST` | `/v1/runs/:id/instructions` | Steer a running run |
| `GET` | `/v1/runs/:id/stream` | SSE event stream |
| `GET` | `/v1/artifacts` | Library, optionally filtered by run |
| `GET` | `/v1/artifacts/:id/export` | Export markdown / text / JSON |
| `GET` | `/v1/usage` | Usage and cost summary |
| `GET/PUT/DELETE` | `/v1/credentials` | Provider credential management |

### Streaming

The mobile client opens the SSE endpoint with a short-lived, run-scoped token. Events are
persisted with a monotonic sequence number; reconnects replay from the last seen event.
Token deltas are ephemeral and never stored.

## Security notes

- Provider credentials are encrypted server-side and redacted from logs.
- Dev auth is disabled automatically in production (`ALLOW_DEV_AUTH=false` required).
- Stream tokens are scoped to a single run and expire quickly.
- All run, artifact, and credential queries are scoped to the authenticated user.
- Rate limiting, Helmet, and strict request validation are enabled on the API.

## Testing

```bash
npm run typecheck
npm test
npm run lint
```

The API test suite covers SSE parsing, credential encryption, shared schema validation,
and utility logic. Mobile and API typechecks must both pass before shipping.

## Troubleshooting

- **`PostgreSQL is not reachable`** — run `docker compose up -d`, then `npm run db:migrate`.
- **App cannot reach the API** — set `EXPO_PUBLIC_API_URL` to your machine's LAN address
  (for example `http://192.168.1.20:4000`) when testing on a physical device.
- **No models available** — add a provider key in `.env` or in **Settings → Provider credentials**.
- **Run never leaves the plan stage** — check the API logs; a missing or invalid provider
  key surfaces as an `agent.failed` event in the run timeline.
