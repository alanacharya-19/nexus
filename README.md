# NEXUS

NEXUS is a multi-agent workspace for mobile. You give it an objective, and a small
team of specialist agents works through it: they plan, do the work, review it, fix
what the review flags, and hand back a finished deliverable. The whole run streams
live, is saved to the database, and can be replayed later.

There's also a plain chat mode if you just want to talk to a single model.

- **Mobile**: Expo, React Native, TypeScript, Expo Router
- **API**: Node, Fastify, PostgreSQL, Server-Sent Events
- **Shared**: one TypeScript package with the domain types, Zod schemas, and model metadata

## Layout

```
apps/
  mobile/    Expo app (iOS, Android, web)
  api/       Fastify API and the orchestration engine
packages/
  shared/    Domain types, schemas, model registry, prompts
```

## How a run works

Every run follows the same pipeline:

```
plan -> work -> review -> revise (only if needed) -> polish -> deliver
```

- The **planner** breaks the objective into an ordered list of steps, each with an artifact.
- **Workers** carry out the steps and write the actual deliverables.
- The **reviewer** checks accuracy, completeness, and risk, and can ask for changes.
- **Revise** re-runs the affected work when the review asks for it.
- The **polisher** produces the final deliverable, and the run is marked complete.

Runs can be paused, resumed, cancelled, retried, steered mid-flight with new
instructions, or held for human approval. Approval modes are `always` (every stage),
`key` (plan and review), and `auto`.

Chat is a separate path. Each conversation stores its own provider and model, streams
incremental Markdown, supports cancellation and reconnect, and keeps the full message
history. It does not run the agent pipeline.

Providers are independent adapters (OpenAI, Anthropic, Google). Model output is
validated against Zod schemas with a single repair attempt, and provider retries and
fallbacks happen before any text reaches the client. Chat uses the same adapters,
timeouts, retry rules, and normalized errors.

## Requirements

- Node.js 20 or newer (developed against 26)
- npm 10 or newer
- PostgreSQL 14 or newer (a Docker Compose file is included)
- Expo Go, an iOS/Android simulator, or a browser for the mobile app

## Setup

```bash
# 1. Install the workspaces
npm install

# 2. Create your env file and edit it
#    At minimum, set a real CREDENTIAL_ENCRYPTION_KEY.
cp .env.example .env

# 3. Start PostgreSQL
docker compose up -d

# 4. Apply the schema
npm run db:migrate

# 5. Start the API (this builds the shared package first)
npm run dev:api

# 6. In another terminal, start the mobile app
npm start          # then press i, a, or w, or scan the QR code
```

The API listens on `http://localhost:4000`. The mobile app figures out the API host
from Expo's `hostUri`. To override it, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`;
the value must include the `/v1` path, for example `http://192.168.1.20:4000/v1`. See
`apps/mobile/.env.example`.

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
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `GOOGLE_BASE_URL` | Optional provider endpoint overrides |
| `MAX_CONCURRENT_RUNS` | Orchestration concurrency limit |
| `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RETRIES` | Provider call limits |
| `CORS_ORIGINS` | Comma-separated allowed origins (`*` in development) |
| `EXPO_PUBLIC_API_URL` | Mobile override for the API base URL |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Mobile Supabase sign-in |

You don't have to put provider keys in `.env`. You can also add them per user under
**Settings -> Providers**. Those keys are encrypted at rest with AES-256-GCM, take
precedence over server keys, and are never sent back to the client. **Settings ->
Personal keys** stores a key on the device with `expo-secure-store` instead; it's sent
only as an authenticated `x-provider-key` header for a single request, never persisted
by the API, and redacted from logs. **Settings -> AI defaults** picks the provider and
model that new conversations start with.

## Scripts

Run these from the repository root:

```bash
npm run dev:api     # API in watch mode (builds shared first)
npm start           # Expo dev server
npm run ios         # Expo on iOS
npm run android     # Expo on Android
npm run web         # Expo in the browser
npm run db:migrate  # Apply SQL migrations
npm run typecheck   # shared + api + mobile
npm test            # API unit tests
npm run lint        # mobile + api ESLint
npm run doctor      # Expo config and dependency health
npm run build:api   # Compile the API to apps/api/dist
npm run build:web   # Static web export to apps/mobile/dist
npm run build:shared
npm run check       # CI gate: typecheck + lint + tests + doctor + API/web builds
```

`npm run check` is exactly what CI runs on every push and pull request
(`.github/workflows/ci.yml`). It should pass before you ship anything.

## API

All routes live under `/v1` (except `/health`). Authenticated routes expect an
`Authorization: Bearer <token>` header. Grouped by area:

| Area | Routes |
| --- | --- |
| Health | `GET /health`, `GET /v1/capabilities` |
| Auth | `POST /v1/auth/dev`, `GET /v1/auth/me` |
| Models | `GET /v1/models` |
| Agents | `GET/POST /v1/agents`, `PATCH/DELETE /v1/agents/:id` |
| Projects | `GET/POST /v1/projects`, `PATCH/DELETE /v1/projects/:id` |
| Templates | `GET/POST /v1/templates`, `DELETE /v1/templates/:id` |
| Runs | `GET/POST /v1/runs`, `GET/PATCH/DELETE /v1/runs/:id` |
| Run control | `POST /v1/runs/:id/{start,pause,resume,cancel,retry,approve,instructions}` |
| Run streaming | `GET /v1/runs/:id/events`, `POST /v1/runs/:id/stream-token`, `GET /v1/runs/:id/stream` |
| Artifacts | `GET /v1/artifacts`, `GET/DELETE /v1/artifacts/:id`, `GET /v1/artifacts/:id/export` |
| Usage | `GET /v1/usage/summary`, `GET /v1/usage/records` |
| Credentials | `GET/POST /v1/credentials`, `PUT/DELETE /v1/credentials/:provider`, `POST /v1/credentials/:provider/test` |
| Conversations | `GET/POST /v1/conversations`, `GET/PATCH/DELETE /v1/conversations/:id` |
| Chat messages | `GET/POST /v1/conversations/:id/messages`, `POST /v1/conversations/:id/stream-token` |
| Chat streaming | `GET /v1/conversations/:id/messages/:messageId/stream`, `POST .../cancel` |
| Preferences | `GET/PUT /v1/preferences/ai` |

### Streaming

The mobile client opens the run or conversation SSE endpoint with a short-lived token
scoped to that one run or conversation. Run events are persisted with a monotonic
sequence number, so a reconnect replays from the last event the client saw. Token
deltas are ephemeral and never stored.

Conversation streams work the same way, scoped to a single assistant message. On
reconnect the client sends the last rendered delta index, gets a `stream.ready`
snapshot, replays only the newer frames, then continues live. Cancelling keeps the
text received so far and marks the message `cancelled`. A provider failure marks it
`error`, records partial usage, and leaves a retry action in the UI. Finished sessions
replay briefly and then close.

## Security notes

- Provider credentials are encrypted server-side and redacted from logs. Personal
  device keys live in the OS secure store and are relayed per request via
  `x-provider-key`; the API never persists or logs them.
- Dev auth is disabled automatically in production (`ALLOW_DEV_AUTH=false` required).
- Stream tokens are scoped to a single run or conversation and expire after 10 minutes.
- All run, conversation, message, artifact, and credential queries are scoped to the
  authenticated user. Client-supplied user ids are never trusted.
- Conversations and messages have RLS ownership policies, and child execution rows
  inherit ownership from their parent run.
- Provider-reported usage is labelled separately from estimated usage and estimated
  cost. The API never invents token counts or prices.
- Rate limiting, Helmet, and strict request validation are enabled on the API.

## Testing

```bash
npm run typecheck
npm test
npm run lint
```

The API test suite covers SSE parsing, credential encryption, shared schema
validation, utility logic, all three provider adapters (streaming, usage, invalid
keys, rate limits, network failures, timeouts, retries, malformed payloads), chat
generation and cancellation, provider-key precedence, migration/RLS assertions, and
ownership enforcement in repository queries. Both the mobile and API typechecks must
pass before shipping.

## Troubleshooting

- **`PostgreSQL is not reachable`**: run `docker compose up -d`, then `npm run db:migrate`.
- **The app can't reach the API**: set `EXPO_PUBLIC_API_URL` to your machine's LAN
  address including the `/v1` path (for example `http://192.168.1.20:4000/v1`) when
  testing on a physical device. A missing `/v1` makes every request return 404.
- **No models available**: add a provider key in `.env` or under **Settings -> Provider credentials**.
- **A run never leaves the plan stage**: check the API logs. A missing or invalid
  provider key shows up as an `agent.failed` event in the run timeline.
