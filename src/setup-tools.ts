import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { Services } from "./runtime.js";
import { jsonText } from "./utils/mcp.js";
import { audited } from "./tools.js";

function set(config: AppConfig, key: string, value: unknown): void {
  (config as Record<string, unknown>)[key] = value;
}

/** Persist all current mail accounts to the runtime_config table. */
async function persistMailAccounts(services: Services): Promise<void> {
  const accounts = services.customMail.exportAccounts();
  await services.db.setRuntimeConfig("mail_accounts", JSON.stringify(accounts));
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
          accounts: services.customMail.listAccountLabels()
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
      if (input.url) {
        set(config, "TURSO_DATABASE_URL", normalizeDbUrl(input.url));
      }
      if (input.authToken !== undefined) set(config, "TURSO_AUTH_TOKEN", input.authToken);
      if (input.syncUrl !== undefined) set(config, "TURSO_SYNC_URL", input.syncUrl);

      await services.db.reconnect(
        input.url ? normalizeDbUrl(input.url) : undefined,
        input.authToken,
        input.syncUrl
      );
      await services.db.ping();

      // Persist to survive restarts
      await services.db.setRuntimeConfig("TURSO_DATABASE_URL", config.TURSO_DATABASE_URL);
      if (config.TURSO_AUTH_TOKEN) {
        await services.db.setRuntimeConfig("TURSO_AUTH_TOKEN", config.TURSO_AUTH_TOKEN);
      }
      if (config.TURSO_SYNC_URL) {
        await services.db.setRuntimeConfig("TURSO_SYNC_URL", config.TURSO_SYNC_URL);
      }

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
      await services.db.setRuntimeConfig("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

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
      account?: string;
      host: string;
      port?: number;
      secure?: boolean;
      user: string;
      password: string;
      mailbox?: string;
    }) => {
      const label = input.account ?? "default";
      services.customMail.addOrUpdateAccount({
        label,
        imap: {
          host: input.host,
          port: input.port ?? 993,
          secure: input.secure ?? true,
          user: input.user,
          password: input.password,
          mailbox: input.mailbox ?? "INBOX"
        }
      });

      await services.customMail.testImapConnection(label);
      await persistMailAccounts(services);

      return jsonText({
        ok: true,
        account: label,
        host: input.host,
        user: input.user
      });
    }),

    setupCustomMailSmtp: audited(services, "setup_custom_mail_smtp", async (input: {
      account?: string;
      host: string;
      port?: number;
      secure?: boolean;
      user?: string;
      password?: string;
      defaultFrom?: string;
    }) => {
      const label = input.account ?? "default";
      services.customMail.addOrUpdateAccount({
        label,
        smtp: {
          host: input.host,
          port: input.port ?? 587,
          secure: input.secure ?? false,
          user: input.user,
          password: input.password
        },
        defaultFrom: input.defaultFrom
      });

      await services.customMail.testSmtpConnection(label);
      await persistMailAccounts(services);

      return jsonText({
        ok: true,
        account: label,
        host: input.host,
        user: input.user ?? null
      });
    }),

    setupMailAccountList: audited(services, "setup_mail_account_list", async () => {
      const accounts = services.customMail.listAccountLabels();
      return jsonText({ accounts });
    }),

    setupMailAccountRemove: audited(
      services,
      "setup_mail_account_remove",
      async ({ account }: { account: string }) => {
        services.customMail.removeAccount(account);
        await persistMailAccounts(services);
        return jsonText({ ok: true, removed: account });
      }
    ),

    setupSlackWebhook: audited(services, "setup_slack_webhook", async (input: {
      webhookUrl: string;
      testMessage?: string;
    }) => {
      set(config, "SLACK_WEBHOOK_URL", input.webhookUrl);

      await services.slack.testConnection(input.testMessage);
      await services.db.setRuntimeConfig("SLACK_WEBHOOK_URL", input.webhookUrl);

      return jsonText({ ok: true });
    }),

    setupConfigReset: audited(services, "setup_config_reset", async () => {
      await services.db.clearRuntimeConfig();

      // Revert in-memory config to .env values
      if (process.env.TURSO_DATABASE_URL) set(config, "TURSO_DATABASE_URL", process.env.TURSO_DATABASE_URL);
      if (process.env.TURSO_AUTH_TOKEN) set(config, "TURSO_AUTH_TOKEN", process.env.TURSO_AUTH_TOKEN);
      if (process.env.TURSO_SYNC_URL) set(config, "TURSO_SYNC_URL", process.env.TURSO_SYNC_URL);
      if (process.env.GOOGLE_REFRESH_TOKEN) set(config, "GOOGLE_REFRESH_TOKEN", process.env.GOOGLE_REFRESH_TOKEN);
      if (process.env.SLACK_WEBHOOK_URL) set(config, "SLACK_WEBHOOK_URL", process.env.SLACK_WEBHOOK_URL);

      // Remove all non-default mail accounts (they came from setup tools or persistence)
      const current = services.customMail.exportAccounts();
      for (const account of current) {
        if (account.label !== "default") {
          services.customMail.removeAccount(account.label);
        }
      }

      return jsonText({
        ok: true,
        note: "Runtime config cleared from DB. .env values are now in effect. Restart recommended for full reset."
      });
    })
  };
}

/**
 * Normalize a database URL so plain file paths are converted to valid libSQL file: URLs.
 * - `libsql://` URLs pass through unchanged.
 * - `file:` URLs pass through unchanged.
 * - `/absolute/path/to/db.db` becomes `file:/absolute/path/to/db.db`
 * - `./relative/path/to/db.db` becomes `file:./relative/path/to/db.db`
 */
export function normalizeDbUrl(raw: string): string {
  if (raw.startsWith("libsql://") || raw.startsWith("file:") || raw.startsWith("http")) {
    return raw;
  }
  return `file:${raw}`;
}
