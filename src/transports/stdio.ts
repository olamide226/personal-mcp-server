import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppConfig } from "../config.js";
import type { Services } from "../runtime.js";
import { createMcpServer } from "../server.js";
import { log } from "../logger.js";

export async function startStdioServer(config: AppConfig, services: Services): Promise<void> {
  const server = createMcpServer(config, services);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "Stdio MCP server connected");
}
