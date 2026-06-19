import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { Services } from "./runtime.js";
import { jsonText } from "./utils/mcp.js";
import { audited } from "./tools.js";

function set(config: AppConfig, key: string, value: unknown): void {
  (config as Record<string, unknown>)[key] = value;
}

export function setupToolHandlers(config: AppConfig, services: Services) {
  return {
    setupStatus: audited(services, "setup_status", async () => {
      return jsonText({
        database: {
          configured: true,
          url: config.TURSO_DATABASE_URL
        },
        gmail: {
          configured: Boolean(config.GOOGLE_REFRESH_TOKEN),
          clientIdConfigured: Boolean(config.GOOGLE_CLIENT_ID),
          clientSecretConfigured: Boolean(config.GOOGLE_CLIENT_SECRET),
          redirectUriConfigured: Boolean(config.GOOGLE_REDIRECT_URI)
        },
        customMail: {
          imapConfigured: Boolean(
            config.CUSTOM_IMAP_HOST && config.CUSTOM_IMAP_USER && config.CUSTOM_IMAP_PASSWORD
          ),
          smtpConfigured: Boolean(config.CUSTOM_SMTP_HOST)
        },
        slack: {
          configured: Boolean(config.SLACK_WEBHOOK_URL)
        }
      });
    }),

    setupDatabase: audited(services, "setup_database", async (input: {
      url?: string;
      authToken?: string;
      syncUrl?: string;
    }) => {
      if (input.url) set(config, "TURSO_DATABASE_URL", input.url);
      if (input.authToken !== undefined) set(config, "TURSO_AUTH_TOKEN", input.authToken);
      if (input.syncUrl !== undefined) set(config, "TURSO_SYNC_URL", input.syncUrl);

      await services.db.reconnect(input.url, input.authToken, input.syncUrl);
      await services.db.ping();

      return jsonText({
        ok: true,
        url: config.TURSO_DATABASE_URL
      });
    }),

    setupGmailOAuthStart: audited(services, "setup_gmail_oauth_start", async (input: {
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
    }) => {
      if (input.clientId) set(config, "GOOGLE_CLIENT_ID", input.clientId);
      if (input.clientSecret) set(config, "GOOGLE_CLIENT_SECRET", input.clientSecret);
      if (input.redirectUri) set(config, "GOOGLE_REDIRECT_URI", input.redirectUri);

      const state = config.GOOGLE_OAUTH_STATE ?? randomUUID();
      const authorizationUrl = services.gmail.getAuthorizationUrl(state);

      return jsonText({
        authorizationUrl,
        state,
        note:
          "Open authorizationUrl in a browser, authorize access, then call setup_gmail_oauth_complete " +
          "with the 'code' parameter from the redirect URL."
      });
    }),

    setupGmailOAuthComplete: audited(services, "setup_gmail_oauth_complete", async (input: {
      code: string;
      state?: string;
    }) => {
      if (config.GOOGLE_OAUTH_STATE && input.state && input.state !== config.GOOGLE_OAUTH_STATE) {
        throw new Error("OAuth state mismatch. CSRF check failed.");
      }

      const tokens = await services.gmail.exchangeCode(input.code);

      if (!tokens.refresh_token) {
        throw new Error(
          "No refresh_token returned. Re-authorize with prompt=consent. " +
          "Revoke access at https://myaccount.google.com/permissions and retry."
        );
      }

      set(config, "GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

      return jsonText({
        ok: true,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        expiryDate: tokens.expiry_date,
        note:
          "Refresh token stored in runtime config. Previous refresh tokens from this " +
          "Google account for the same client may be invalidated."
      });
    }),

    setupCustomMailImap: audited(services, "setup_custom_mail_imap", async (input: {
      host: string;
      port?: number;
      secure?: boolean;
      user: string;
      password: string;
      mailbox?: string;
    }) => {
      set(config, "CUSTOM_IMAP_HOST", input.host);
      if (input.port !== undefined) set(config, "CUSTOM_IMAP_PORT", input.port);
      if (input.secure !== undefined) set(config, "CUSTOM_IMAP_SECURE", input.secure);
      set(config, "CUSTOM_IMAP_USER", input.user);
      set(config, "CUSTOM_IMAP_PASSWORD", input.password);
      if (input.mailbox !== undefined) set(config, "CUSTOM_IMAP_MAILBOX", input.mailbox);

      await services.customMail.testImapConnection();

      return jsonText({
        ok: true,
        host: input.host,
        user: input.user
      });
    }),

    setupCustomMailSmtp: audited(services, "setup_custom_mail_smtp", async (input: {
      host: string;
      port?: number;
      secure?: boolean;
      user?: string;
      password?: string;
      defaultFrom?: string;
    }) => {
      set(config, "CUSTOM_SMTP_HOST", input.host);
      if (input.port !== undefined) set(config, "CUSTOM_SMTP_PORT", input.port);
      if (input.secure !== undefined) set(config, "CUSTOM_SMTP_SECURE", input.secure);
      if (input.user !== undefined) set(config, "CUSTOM_SMTP_USER", input.user);
      if (input.password !== undefined) set(config, "CUSTOM_SMTP_PASSWORD", input.password);
      if (input.defaultFrom) set(config, "EMAIL_DEFAULT_FROM", input.defaultFrom);

      await services.customMail.testSmtpConnection();

      return jsonText({
        ok: true,
        host: input.host,
        user: input.user ?? null
      });
    }),

    setupSlackWebhook: audited(services, "setup_slack_webhook", async (input: {
      webhookUrl: string;
      testMessage?: string;
    }) => {
      set(config, "SLACK_WEBHOOK_URL", input.webhookUrl);

      await services.slack.testConnection(input.testMessage);

      return jsonText({ ok: true });
    })
  };
}
