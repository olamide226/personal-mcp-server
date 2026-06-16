# Personal MCP Server

Private TypeScript MCP server for Gmail, custom IMAP/SMTP mail, Slack notifications, and personal “soul docs” in SQLite-compatible Turso/libSQL.

## Tools

- `gmail_search_messages`, `gmail_get_message`
- `custom_mail_search_messages`, `custom_mail_get_message`
- `email_prepare_send`, `email_confirm_send`
- `send_slack_notification`
- `get_my_soul_docs`, `write_my_soul_doc`

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in secrets.
3. Build and test: `npm run build && npm test`
4. Run HTTP mode: `npm start`
5. Run stdio mode: `npm run start:stdio`

HTTP mode requires `MCP_BEARER_TOKEN`. Send it as:

```http
Authorization: Bearer your-token
```

The MCP endpoint is `POST /mcp`. Health check is `GET /healthz`.

## Gmail OAuth

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_OAUTH_STATE`.
With the server running, call `GET /oauth/google/start` with bearer auth. Open the returned authorization URL. The callback returns a `refresh_token`; store it in `GOOGLE_REFRESH_TOKEN`.

Requested Gmail scopes are:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

## Database

Local development uses `TURSO_DATABASE_URL=file:local.db` or `:memory:` in tests. For Turso, use a `libsql://...` URL plus `TURSO_AUTH_TOKEN`.

## Docker

```bash
docker compose up --build
```

For a remote deployment, set `MCP_HOST=0.0.0.0`, a strong `MCP_BEARER_TOKEN`, and explicit `MCP_ALLOWED_ORIGINS`.
