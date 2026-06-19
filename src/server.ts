import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Services } from "./runtime.js";
import { emailDraftSchema, mailSearchSchema, toolHandlers } from "./tools.js";
import { setupToolHandlers } from "./setup-tools.js";

export function createMcpServer(config: AppConfig, services: Services): McpServer {
  const server = new McpServer(
    {
      name: config.MCP_NAME,
      version: config.MCP_VERSION
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  const handlers = toolHandlers(services);

  server.registerTool(
    "gmail_search_messages",
    {
      title: "Search Gmail messages",
      description: "Search Gmail using Gmail query semantics built from typed filters.",
      inputSchema: mailSearchSchema
    },
    handlers.gmailSearchMessages
  );

  server.registerTool(
    "gmail_get_message",
    {
      title: "Get Gmail message",
      description: "Fetch a Gmail message by id.",
      inputSchema: {
        id: z.string().min(1).describe("Gmail message ID.")
      }
    },
    handlers.gmailGetMessage
  );

  server.registerTool(
    "custom_mail_search_messages",
    {
      title: "Search custom mailbox",
      description: "Search the configured custom IMAP mailbox.",
      inputSchema: mailSearchSchema
    },
    handlers.customMailSearchMessages
  );

  server.registerTool(
    "custom_mail_get_message",
    {
      title: "Get custom mailbox message",
      description: "Fetch a message from the configured custom IMAP mailbox by UID.",
      inputSchema: {
        uid: z.number().int().positive().describe("IMAP message UID.")
      }
    },
    handlers.customMailGetMessage
  );

  server.registerTool(
    "email_prepare_send",
    {
      title: "Prepare email send",
      description: "Validate and stage an email. Returns a confirmation id; does not send.",
      inputSchema: emailDraftSchema
    },
    handlers.emailPrepareSend
  );

  server.registerTool(
    "email_confirm_send",
    {
      title: "Confirm email send",
      description: "Send a previously prepared email using its confirmation id.",
      inputSchema: {
        confirmationId: z.string().uuid()
          .describe("Confirmation ID returned by email_prepare_send.")
      }
    },
    handlers.emailConfirmSend
  );

  server.registerTool(
    "send_slack_notification",
    {
      title: "Send Slack notification",
      description: "Send a notification to the configured Slack incoming webhook.",
      inputSchema: {
        text: z.string().min(1).describe("Notification text (markdown supported)."),
        blocks: z.array(z.unknown()).optional()
          .describe("Optional Slack Block Kit blocks for rich formatting.")
      }
    },
    handlers.sendSlackNotification
  );

  server.registerTool(
    "get_my_soul_docs",
    {
      title: "Get soul docs",
      description:
        "Read/search personal soul docs stored in the SQLite-compatible DB. " +
        "Returns docs ordered by most recently updated first.",
      inputSchema: {
        query: z.string().optional()
          .describe(
            "Full-text search term matched against title, content, and source. " +
            "Uses SQL LIKE with wildcards on both sides — partial matches work. " +
            "Omit to return all docs."
          ),
        tag: z.string().optional()
          .describe(
            "Exact-match filter on tags. Docs must have at least one tag matching this value. " +
            "Omit to skip tag filtering."
          ),
        limit: z.number().int().min(1).max(100).default(20)
          .describe("Maximum number of docs to return (1-100). Default 20.")
      }
    },
    handlers.getMySoulDocs
  );

  server.registerTool(
    "write_my_soul_doc",
    {
      title: "Write soul doc",
      description: "Create or update a personal soul doc in the SQLite-compatible DB.",
      inputSchema: {
        id: z.string().uuid().optional()
          .describe(
            "UUID of an existing doc to update (upsert). " +
            "When provided, the original created_at is preserved and all other fields are overwritten. " +
            "When omitted, a new doc is created with a fresh UUID."
          ),
        title: z.string().min(1)
          .describe(
            "Document title. This is the primary label shown in results. " +
            "It is also full-text searched by the query param in get_my_soul_docs."
          ),
        content: z.string().min(1)
          .describe(
            "Document body. Full-text searched by the query param in get_my_soul_docs. " +
            "Use this for the actual knowledge or note content."
          ),
        tags: z.array(z.string().min(1)).default([])
          .describe(
            "Tags for categorization and filtering. " +
            "Used by the tag param in get_my_soul_docs for exact-match filtering. " +
            "Use lowercase, kebab-case or single words (e.g. 'typescript', 'meeting-notes')."
          ),
        source: z.string().optional()
          .describe(
            "Where this doc originated — a URL, conversation title, file path, or project name. " +
            "Full-text searched by the query param in get_my_soul_docs. " +
            "Useful for tracing a doc back to its origin."
          ),
        metadata: z.record(z.unknown()).default({})
          .describe(
            "Arbitrary key-value pairs for structured data (dates, counts, statuses, cross-references). " +
            "Stored as JSON — use for data you might want to inspect programmatically. " +
            "Not searchable via get_my_soul_docs; put searchable text in content or source instead."
          )
      }
    },
    handlers.writeMySoulDoc
  );

  // ── Setup tools (disabled when MCP_ENABLE_SETUP_TOOLS=false) ──

  if (!config.MCP_ENABLE_SETUP_TOOLS) {
    return server;
  }

  const setup = setupToolHandlers(config, services);

  server.registerTool(
    "setup_status",
    {
      title: "Setup status",
      description: "Show which services are configured (no secrets exposed).",
      inputSchema: {}
    },
    setup.setupStatus
  );

  server.registerTool(
    "setup_database",
    {
      title: "Setup database",
      description:
        "Configure a Turso/libSQL database URL and auth token, then test the connection. " +
        "Overrides .env values at runtime.",
      inputSchema: {
        url: z.string().min(1).optional()
          .describe(
            "Database URL. Accepts libsql:// for Turso, file: for local, " +
            "or a plain path like /data/db.sqlite (auto-prefixed with file:). " +
            "Overrides TURSO_DATABASE_URL."
          ),
        authToken: z.string().optional()
          .describe("Turso auth token (overrides TURSO_AUTH_TOKEN)"),
        syncUrl: z.string().url().optional()
          .describe("Turso sync URL (overrides TURSO_SYNC_URL)")
      }
    },
    setup.setupDatabase
  );

  server.registerTool(
    "setup_gmail_oauth_start",
    {
      title: "Start Gmail OAuth setup",
      description:
        "Generate a Google OAuth authorization URL. Open it in a browser, authorize, " +
        "then call setup_gmail_oauth_complete with the code from the redirect URL.",
      inputSchema: {
        clientId: z.string().optional()
          .describe("Google OAuth client ID (overrides GOOGLE_CLIENT_ID)"),
        clientSecret: z.string().optional()
          .describe("Google OAuth client secret (overrides GOOGLE_CLIENT_SECRET)"),
        redirectUri: z.string().optional()
          .describe("OAuth redirect URI (overrides GOOGLE_REDIRECT_URI)")
      }
    },
    setup.setupGmailOAuthStart
  );

  server.registerTool(
    "setup_gmail_oauth_complete",
    {
      title: "Complete Gmail OAuth setup",
      description:
        "Exchange an OAuth authorization code for tokens. Stores the refresh_token " +
        "in the runtime config (does not write .env).",
      inputSchema: {
        code: z.string().min(1)
          .describe("OAuth authorization code from the redirect URL query parameter"),
        state: z.string().optional()
          .describe("State parameter for CSRF verification")
      }
    },
    setup.setupGmailOAuthComplete
  );

  server.registerTool(
    "setup_custom_mail_imap",
    {
      title: "Setup custom IMAP",
      description:
        "Configure IMAP credentials and test the connection. " +
        "Overrides .env values at runtime.",
      inputSchema: {
        host: z.string().min(1)
          .describe("IMAP server hostname (e.g., imap.example.com)"),
        port: z.number().int().positive().default(993)
          .describe("IMAP server port"),
        secure: z.boolean().default(true)
          .describe("Use TLS (true for 993, false for 143)"),
        user: z.string().min(1)
          .describe("IMAP username (usually the full email address)"),
        password: z.string().min(1)
          .describe("IMAP password or app password"),
        mailbox: z.string().default("INBOX")
          .describe("IMAP mailbox folder")
      }
    },
    setup.setupCustomMailImap
  );

  server.registerTool(
    "setup_custom_mail_smtp",
    {
      title: "Setup custom SMTP",
      description:
        "Configure SMTP credentials and test the connection. " +
        "Overrides .env values at runtime.",
      inputSchema: {
        host: z.string().min(1)
          .describe("SMTP server hostname (e.g., smtp.example.com)"),
        port: z.number().int().positive().default(587)
          .describe("SMTP server port"),
        secure: z.boolean().default(false)
          .describe("Use TLS (true for 465, false for 587 with STARTTLS)"),
        user: z.string().optional()
          .describe("SMTP username (required if auth is needed)"),
        password: z.string().optional()
          .describe("SMTP password"),
        defaultFrom: z.string().email().optional()
          .describe("Default from address for outgoing email")
      }
    },
    setup.setupCustomMailSmtp
  );

  server.registerTool(
    "setup_slack_webhook",
    {
      title: "Setup Slack webhook",
      description:
        "Configure a Slack incoming webhook URL and send a test notification. " +
        "Overrides SLACK_WEBHOOK_URL at runtime.",
      inputSchema: {
        webhookUrl: z.string().url()
          .describe("Slack incoming webhook URL"),
        testMessage: z.string().optional()
          .describe("Optional test message content")
      }
    },
    setup.setupSlackWebhook
  );

  return server;
}
