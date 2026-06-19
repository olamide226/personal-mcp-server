import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .optional()
  .transform((value) => value === true || value === "true");

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  MCP_NAME: z.string().default("personal-mcp-server"),
  MCP_VERSION: z.string().default("0.1.0"),
  MCP_PORT: z.coerce.number().int().positive().default(3000),
  MCP_HOST: z.string().default("127.0.0.1"),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_ALLOWED_ORIGINS: z.string().default("*"),
  MCP_ENABLE_SETUP_TOOLS: boolFromEnv.default(true),

  TURSO_DATABASE_URL: z.string().default("file:local.db"),
  TURSO_AUTH_TOKEN: z.string().optional(),
  TURSO_SYNC_URL: z.string().optional(),
  TURSO_SYNC_INTERVAL_MS: z.coerce.number().int().positive().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_OAUTH_STATE: z.string().optional(),

  CUSTOM_IMAP_HOST: z.string().optional(),
  CUSTOM_IMAP_PORT: z.coerce.number().int().positive().default(993),
  CUSTOM_IMAP_SECURE: boolFromEnv.default(true),
  CUSTOM_IMAP_USER: z.string().optional(),
  CUSTOM_IMAP_PASSWORD: z.string().optional(),
  CUSTOM_IMAP_MAILBOX: z.string().default("INBOX"),

  CUSTOM_SMTP_HOST: z.string().optional(),
  CUSTOM_SMTP_PORT: z.coerce.number().int().positive().default(587),
  CUSTOM_SMTP_SECURE: boolFromEnv.default(false),
  CUSTOM_SMTP_USER: z.string().optional(),
  CUSTOM_SMTP_PASSWORD: z.string().optional(),

  EMAIL_DEFAULT_FROM: z.string().email().optional(),
  EMAIL_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  SLACK_WEBHOOK_URL: z.string().url().optional()
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    allowedOrigins: parsed.MCP_ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  };
}

export function assertHttpConfig(_config: AppConfig): void {
  // MCP_BEARER_TOKEN is optional — when unset, all requests are authorized.
}

/** Mutate a config property at runtime. Used by setup tools to override .env values. */
export function setConfigValue(config: AppConfig, key: string, value: unknown): void {
  (config as Record<string, unknown>)[key] = value;
}
