# Personal MCP Server

A private, single-user MCP (Model Context Protocol) server that gives AI agents access to your email, Slack notifications, and a personal knowledge base ("soul docs"). Written in TypeScript, runs over HTTP (Streamable HTTP) or stdio.

**Capabilities at a glance:**
- Search and read Gmail or any IMAP mailbox
- Send email via Gmail API or custom SMTP (with a prepare→confirm safety flow)
- Post Slack notifications via incoming webhooks
- CRUD a personal knowledge base backed by SQLite or Turso/libSQL
- Configure all credentials at runtime via MCP tools — no `.env` editing required

---

## Tools

### Mail — Gmail

| Tool | Summary |
|------|---------|
| `gmail_search_messages` | Search Gmail with typed filters (from, to, subject, text, label, unread, date range). Returns summaries. |
| `gmail_get_message` | Fetch a full Gmail message by ID — headers, plain text body, HTML body. |

### Mail — Custom IMAP / SMTP

| Tool | Summary |
|------|---------|
| `custom_mail_search_messages` | Search a custom IMAP mailbox with the same typed filters. |
| `custom_mail_get_message` | Fetch a full message from the custom IMAP mailbox by UID. |
| `email_prepare_send` | Validate and stage an email draft. Returns a confirmation ID; **does not send**. |
| `email_confirm_send` | Send a previously staged email using its confirmation ID. The two-step flow prevents accidental sends. |

### Slack

| Tool | Summary |
|------|---------|
| `send_slack_notification` | Post a message (plain text or Block Kit blocks) to a configured Slack incoming webhook. |

### Soul Docs (personal knowledge base)

| Tool | Summary |
|------|---------|
| `get_my_soul_docs` | Search docs by full-text query (title, content, source) or filter by tag. Returns newest first. |
| `write_my_soul_doc` | Create or update a doc. Pass an `id` to upsert (preserves original `created_at`); omit to create new. Each doc has a title, body content, tags, an optional source reference, and arbitrary metadata. |

### Setup (runtime configuration)

When `MCP_ENABLE_SETUP_TOOLS=true` (the default), these tools let you configure every service at runtime and test connections immediately. All changes are in-memory — they override `.env` values but reset on restart.

| Tool | Summary |
|------|---------|
| `setup_status` | Show which services are configured (no secrets exposed). |
| `setup_database` | Set a Turso/libSQL URL or local file path, then test the connection. Accepts `libsql://`, `file:`, or plain paths like `/data/db.sqlite`. |
| `setup_gmail_oauth_start` | Generate a Google OAuth authorization URL. Optionally override client ID, secret, and redirect URI. |
| `setup_gmail_oauth_complete` | Exchange the OAuth authorization code for a refresh token and store it in the runtime config. |
| `setup_custom_mail_imap` | Set IMAP host, port, credentials, and mailbox — then test the connection. |
| `setup_custom_mail_smtp` | Set SMTP host, port, credentials, and default from address — then verify the connection. |
| `setup_slack_webhook` | Set a Slack incoming webhook URL and send a test notification. |

Set `MCP_ENABLE_SETUP_TOOLS=false` to disable all setup tools and use `.env`-only configuration.

---

## Configuration reference

Every setting can be provided via `.env` or overridden at runtime by the corresponding `setup_*` tool.

### Runtime

| Variable | Default | Notes |
|----------|---------|-------|
| `MCP_TRANSPORT` | `http` | `http` or `stdio` |
| `MCP_PORT` | `3000` | HTTP listen port |
| `MCP_HOST` | `127.0.0.1` | Set to `0.0.0.0` for remote access |
| `MCP_BEARER_TOKEN` | — | Optional. When set, requires `Authorization: Bearer <token>` on all requests |
| `MCP_ALLOWED_ORIGINS` | `*` | Comma-separated origins or `*` for all |
| `MCP_ENABLE_SETUP_TOOLS` | `true` | Set to `false` to remove `setup_*` tools |

### Database

| Variable | Default | Notes |
|----------|---------|-------|
| `TURSO_DATABASE_URL` | `file:local.db` | `file:` for local SQLite, `libsql://` for Turso, or a plain path |
| `TURSO_AUTH_TOKEN` | — | Required for Turso remote databases |
| `TURSO_SYNC_URL` | — | Sync endpoint for embedded replicas |
| `TURSO_SYNC_INTERVAL_MS` | — | Sync interval in ms for embedded replicas |

### Gmail OAuth

| Variable | Required | Notes |
|----------|----------|-------|
| `GOOGLE_CLIENT_ID` | Yes | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | Yes | e.g. `http://127.0.0.1:3000/oauth/google/callback` |
| `GOOGLE_REFRESH_TOKEN` | — | Obtained via OAuth flow; stored at runtime by `setup_gmail_oauth_complete` |
| `GOOGLE_OAUTH_STATE` | — | Optional CSRF state string |

Scopes requested: `gmail.readonly`, `gmail.send`.

### Custom IMAP

| Variable | Default | Notes |
|----------|---------|-------|
| `CUSTOM_IMAP_HOST` | — | IMAP server hostname |
| `CUSTOM_IMAP_PORT` | `993` | |
| `CUSTOM_IMAP_SECURE` | `true` | TLS |
| `CUSTOM_IMAP_USER` | — | Usually the full email address |
| `CUSTOM_IMAP_PASSWORD` | — | App password recommended |
| `CUSTOM_IMAP_MAILBOX` | `INBOX` | |

### Custom SMTP

| Variable | Default | Notes |
|----------|---------|-------|
| `CUSTOM_SMTP_HOST` | — | SMTP server hostname |
| `CUSTOM_SMTP_PORT` | `587` | |
| `CUSTOM_SMTP_SECURE` | `false` | `true` for port 465, `false` for 587 (STARTTLS) |
| `CUSTOM_SMTP_USER` | — | Optional |
| `CUSTOM_SMTP_PASSWORD` | — | Optional |
| `EMAIL_DEFAULT_FROM` | — | Default sender address |
| `EMAIL_CONFIRMATION_TTL_SECONDS` | `600` | Expiry for staged-but-unsent emails |

### Slack

| Variable | Notes |
|----------|-------|
| `SLACK_WEBHOOK_URL` | Incoming webhook URL |

---

## Getting started

### Path A: .env (static config)

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm run build
npm start                   # HTTP on port 3000
# or: npm run start:stdio   # stdio transport
```

### Path B: setup tools (runtime config)

```bash
npm install
npm run build
npm start
```

Then, from your MCP client, call the `setup_*` tools in any order:

1. **`setup_database`** — point to your DB (or skip; `file:local.db` is the default)
2. **`setup_gmail_oauth_start`** → open the URL → **`setup_gmail_oauth_complete`** with the code
3. **`setup_custom_mail_imap`** + **`setup_custom_mail_smtp`** — configure mail
4. **`setup_slack_webhook`** — configure Slack
5. **`setup_status`** — verify everything is wired up

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | MCP Streamable HTTP — requires `Accept: application/json, text/event-stream` |
| `GET` | `/healthz` | Health check |
| `GET` | `/oauth/google/start` | Start Gmail OAuth flow (HTTP mode only) |
| `GET` | `/oauth/google/callback` | Gmail OAuth callback (HTTP mode only) |

---

## Architecture

```
src/
├── config.ts          Env parsing (Zod), defaults, setConfigValue helper
├── index.ts           Entry point — loads config, creates services, starts transport
├── runtime.ts         Service factory — wires up all services with shared config
├── server.ts          MCP server — registers all tools, conditionally includes setup tools
├── setup-tools.ts     Runtime config tools — mutate config, test connections
├── tools.ts           Core tool handlers — email, Slack, soul docs
├── errors.ts          Custom error classes
├── logger.ts          Structured JSON logging
├── types.ts           Shared TypeScript interfaces
├── transports/
│   ├── http.ts        Streamable HTTP transport + OAuth callback routes
│   └── stdio.ts       Stdio transport
├── services/
│   ├── database.ts    Turso/libSQL client — soul_docs, send_confirmations, audit_log
│   ├── gmail.ts       Gmail API via googleapis — search, read, send, OAuth
│   ├── custom-mail.ts IMAP (imapflow) + SMTP (nodemailer) — search, read, send
│   ├── email-sender.tsComposite — delegates to Gmail or SMTP based on provider
│   └── slack.ts       Slack incoming webhook via fetch
└── utils/
    ├── email.ts       MIME builder, base64url helpers
    └── mcp.ts         jsonText() response formatter
```

**Key design choices:**
- **Shared mutable config** — All services hold a reference to the same `AppConfig` object. Setup tools mutate it directly; lazy services (Gmail, IMAP, SMTP, Slack) pick up changes on the next call. Only `DatabaseService` needs an explicit `reconnect()` since it creates the libSQL client eagerly.
- **Audit logging** — Every tool call is logged to the `audit_log` table with success/failure, args (secrets redacted), and a timestamp.
- **Two-step email send** — `email_prepare_send` stages a draft (stored in DB with a TTL), `email_confirm_send` consumes it. Prevents accidental sends and gives the agent a chance to review.
- **OAuth works in both transports** — HTTP mode has dedicated callback routes; stdio mode uses the `setup_gmail_oauth_start` / `setup_gmail_oauth_complete` tools where the user copies the code manually.

---

## Database

Three tables are created automatically on startup:

| Table | Purpose |
|-------|---------|
| `soul_docs` | Personal knowledge base — title, content, tags, source, metadata, timestamps |
| `send_confirmations` | Staged email drafts with expiry and single-use tokens |
| `audit_log` | Immutable record of every tool invocation |

### Local vs remote

```env
# Local SQLite (relative to working directory)
TURSO_DATABASE_URL=file:local.db

# Local SQLite (absolute — for pods/containers that need persistent state)
TURSO_DATABASE_URL=file:/data/my-server.db

# Remote Turso
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

Plain paths passed to `setup_database` are auto-prefixed with `file:` — so `/data/db.sqlite` becomes `file:/data/db.sqlite`.

---

## Deployment

### Docker

```bash
docker compose up --build
```

### Bare metal / pod

```bash
npm ci --omit=dev
npm run build
MCP_HOST=0.0.0.0 MCP_PORT=3000 TURSO_DATABASE_URL=file:/data/server.db node dist/index.js
```

For production, set a strong `MCP_BEARER_TOKEN` and restrict `MCP_ALLOWED_ORIGINS` to your client origin(s).

### Health check

```bash
curl http://localhost:3000/healthz
# {"ok":true,"name":"personal-mcp-server","version":"0.1.0"}
```

---

## Development

```bash
npm install
npm run dev          # tsx watch — auto-reload on changes
npm run build        # tsc
npm test             # vitest
npm run lint         # eslint
npm run typecheck    # tsc --noEmit (includes tests/)
```
