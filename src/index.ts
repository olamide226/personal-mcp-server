import { assertHttpConfig, loadConfig, setConfigValue } from "./config.js";
import { log, logError } from "./logger.js";
import { createServices } from "./runtime.js";
import { startHttpServer } from "./transports/http.js";
import { startStdioServer } from "./transports/stdio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.MCP_TRANSPORT === "streamable-http") {
    assertHttpConfig(config);
  }

  const services = createServices(config);
  await services.db.init();

  // Apply persisted runtime config (DB overrides .env)
  await applyRuntimeOverrides(config, services);

  if (config.MCP_TRANSPORT === "stdio") {
    await startStdioServer(config, services);
    return;
  }

  // streamable-http (default)
  const httpServer = await startHttpServer(config, services);
  const shutdown = async (signal: string) => {
    log("info", "Shutting down", { signal });
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logError("Startup failed", error);
  process.exit(1);
});

async function applyRuntimeOverrides(
  config: ReturnType<typeof loadConfig>,
  services: ReturnType<typeof createServices>
): Promise<void> {
  const overrides = await services.db.getRuntimeConfig();
  if (Object.keys(overrides).length === 0) return;

  // Apply scalar overrides (DB values win over .env)
  const scalarKeys = [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "TURSO_SYNC_URL",
    "GOOGLE_REFRESH_TOKEN",
    "SLACK_WEBHOOK_URL"
  ];

  for (const key of scalarKeys) {
    if (overrides[key]) {
      setConfigValue(config, key, overrides[key]);
    }
  }

  // Reconnect DB if the URL or token was overridden
  const dbUrlOverridden = overrides["TURSO_DATABASE_URL"];
  const dbTokenOverridden = overrides["TURSO_AUTH_TOKEN"];
  if (dbUrlOverridden || dbTokenOverridden) {
    await services.db.reconnect(
      dbUrlOverridden ?? undefined,
      dbTokenOverridden ?? undefined,
      overrides["TURSO_SYNC_URL"] ?? undefined
    );
  }

  // Apply persisted mail accounts
  const mailAccountsJson = overrides["mail_accounts"];
  if (mailAccountsJson) {
    try {
      const accounts: unknown = JSON.parse(mailAccountsJson);
      if (Array.isArray(accounts)) {
        services.customMail.loadAccounts(accounts as never);
        log("info", "Loaded persisted mail accounts", { count: accounts.length });
      }
    } catch (err) {
      log("warn", "Failed to parse persisted mail_accounts, skipping", {
        error: String(err)
      });
    }
  }

  const count = Object.keys(overrides).length;
  log("info", "Applied persisted runtime config", { keys: count });
}
