import { assertHttpConfig, loadConfig } from "./config.js";
import { log, logError } from "./logger.js";
import { createServices } from "./runtime.js";
import { startHttpServer } from "./transports/http.js";
import { startStdioServer } from "./transports/stdio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.MCP_TRANSPORT === "http") {
    assertHttpConfig(config);
  }

  const services = createServices(config);
  await services.db.init();

  if (config.MCP_TRANSPORT === "stdio") {
    await startStdioServer(config, services);
    return;
  }

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
