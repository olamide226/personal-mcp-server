import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "../config.js";
import type { Services } from "../runtime.js";
import { createMcpServer } from "../server.js";
import { errorMessage } from "../errors.js";
import { log, logError } from "../logger.js";

export async function startHttpServer(config: AppConfig, services: Services): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(config, services, req, res);
    } catch (error) {
      logError("Unhandled HTTP request error", error);
      sendJson(res, 500, {
        error: "Internal server error"
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.MCP_PORT, config.MCP_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  log("info", "HTTP MCP server listening", {
    host: config.MCP_HOST,
    port: config.MCP_PORT
  });

  return server;
}

async function routeRequest(
  config: AppConfig,
  services: Services,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      name: config.MCP_NAME,
      version: config.MCP_VERSION
    });
    return;
  }

  if (url.pathname === "/oauth/google/start") {
    if (!isAuthorized(config, req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    const state = config.GOOGLE_OAUTH_STATE ?? randomUUID();
    sendJson(res, 200, {
      authorizationUrl: services.gmail.getAuthorizationUrl(state),
      state,
      note:
        "Open authorizationUrl, approve access, then Google will call /oauth/google/callback. Persist the returned refresh_token in GOOGLE_REFRESH_TOKEN."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth/google/callback") {
    await handleGoogleCallback(config, services, url, res);
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!isAuthorized(config, req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  if (!isAllowedOrigin(config, req)) {
    sendJson(res, 403, { error: "Forbidden origin" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const mcpServer = createMcpServer(config, services);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      transport.close().catch(() => undefined);
      mcpServer.close();
    });
  } catch (error) {
    logError("MCP request failed", error);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: errorMessage(error)
        },
        id: null
      });
    }
  }
}

async function handleGoogleCallback(
  config: AppConfig,
  services: Services,
  url: URL,
  res: ServerResponse
): Promise<void> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) {
    sendJson(res, 400, { error: "Missing OAuth code" });
    return;
  }
  if (config.GOOGLE_OAUTH_STATE && state !== config.GOOGLE_OAUTH_STATE) {
    sendJson(res, 400, { error: "Invalid OAuth state" });
    return;
  }

  const tokens = await services.gmail.exchangeCode(code);
  sendJson(res, 200, {
    ok: true,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    expiry_date: tokens.expiry_date,
    note: "Store refresh_token in GOOGLE_REFRESH_TOKEN. This response is intentionally shown only once by Google when prompt=consent returns a refresh token."
  });
}

function isAuthorized(config: AppConfig, req: IncomingMessage): boolean {
  // When no bearer token is configured, all requests are authorized.
  if (!config.MCP_BEARER_TOKEN) {
    return true;
  }
  const expected = `Bearer ${config.MCP_BEARER_TOKEN}`;
  return req.headers.authorization === expected;
}

function isAllowedOrigin(config: AppConfig, req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  // "*" means allow all origins.
  if (config.allowedOrigins.length === 1 && config.allowedOrigins[0] === "*") {
    return true;
  }
  return config.allowedOrigins.includes(origin);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body, null, 2));
}
