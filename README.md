# Personal MCP Server

Private TypeScript MCP server for Gmail, custom IMAP/SMTP mail, Slack notifications, and personal “soul docs” in SQLite-compatible Turso/libSQL.

## Tools

### Core tools

- `gmail_search_messages`, `gmail_get_message`
- `custom_mail_search_messages`, `custom_mail_get_message`
- `email_prepare_send`, `email_confirm_send`
- `send_slack_notification`
- `get_my_soul_docs`, `write_my_soul_doc`

### Setup tools (runtime configuration)

When `MCP_ENABLE_SETUP_TOOLS=true` (the default), seven additional tools let you configure services at runtime and test connections — no `.env` editing required. When disabled, only `.env` configuration is available.

| Tool | What it does |
|------|-------------|
| `setup_status` | Show which services are configured (no secrets exposed) |
| `setup_database` | Configure Turso/libSQL URL + auth token, test connection |
| `setup_gmail_oauth_start` | Generate Google OAuth authorization URL |
| `setup_gmail_oauth_complete` | Exchange OAuth code for refresh token, store in config |
| `setup_custom_mail_imap` | Configure IMAP credentials, test connection |
| `setup_custom_mail_smtp` | Configure SMTP credentials, test connection |
| `setup_slack_webhook` | Configure Slack webhook URL, send test notification |

All setup tools override `.env` values at runtime (in-memory only — config resets on restart). Set `MCP_ENABLE_SETUP_TOOLS=false` to remove these tools entirely.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in secrets — or skip this and use the `setup_*` tools at runtime.
3. Build and test: `npm run build && npm test`
4. Run HTTP mode: `npm start`
5. Run stdio mode: `npm run start:stdio`

### Auth

`MCP_BEARER_TOKEN` is optional. When set, requests must include:

```http
Authorization: Bearer your-token
```

When left empty, all requests are authorized — convenient for local development.

### CORS

`MCP_ALLOWED_ORIGINS` defaults to `*` (allow all origins). Set it to a comma-separated list of specific origins to restrict cross-origin access.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |
| `GET` | `/healthz` | Health check |
| `GET` | `/oauth/google/start` | Start Gmail OAuth flow |
| `GET` | `/oauth/google/callback` | Gmail OAuth callback |

## Gmail OAuth

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_OAUTH_STATE`.
With the server running, call `GET /oauth/google/start` with bearer auth. Open the returned authorization URL. The callback returns a `refresh_token`; store it in `GOOGLE_REFRESH_TOKEN`.

Requested Gmail scopes are:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

## Database

The server supports local SQLite files and remote Turso databases via libSQL.

### Local (file)

```env
# Default — saves to the working directory
TURSO_DATABASE_URL=file:local.db

# Custom path for pods/containers (absolute path recommended)
TURSO_DATABASE_URL=file:/data/my-server.db
```

When using a plain path (e.g. via `setup_database`), the `file:` prefix is added automatically:
```json
{ "url": "/data/my-server.db" }   // becomes file:/data/my-server.db
{ "url": "file:./data/db.sqlite" } // stays as-is
```

### Remote (Turso)

```env
TURSO_DATABASE_URL=libsql://your-db-your-org.turso.io
TURSO_AUTH_TOKEN=your-turso-token
```

Use `TURSO_SYNC_URL` and `TURSO_SYNC_INTERVAL_MS` for embedded replicas. The `setup_database` tool can also switch between local and remote at runtime.

## Docker

```bash
docker compose up --build
```

For a remote deployment, set `MCP_HOST=0.0.0.0`. It's recommended to also set a strong `MCP_BEARER_TOKEN` and restrict `MCP_ALLOWED_ORIGINS` to your frontend origin(s) — both are optional but improve security.
