import { describe, expect, it, vi } from "vitest";
import { normalizeDbUrl, setupToolHandlers } from "../src/setup-tools.js";
import type { AppConfig } from "../src/config.js";
import type { Services } from "../src/runtime.js";

function textPayload(
  result: Awaited<ReturnType<ReturnType<typeof setupToolHandlers>["setupStatus"]>>
) {
  return JSON.parse(result.content[0].text);
}

// ── normalizeDbUrl ──────────────────────────────────────────

describe("normalizeDbUrl", () => {
  it("passes libsql:// URLs through unchanged", () => {
    expect(normalizeDbUrl("libsql://my-db.turso.io")).toBe("libsql://my-db.turso.io");
  });

  it("passes file: URLs through unchanged", () => {
    expect(normalizeDbUrl("file:/data/my-db.db")).toBe("file:/data/my-db.db");
    expect(normalizeDbUrl("file:local.db")).toBe("file:local.db");
  });

  it("passes http/https URLs through unchanged", () => {
    expect(normalizeDbUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeDbUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("prefixes an absolute path with file:", () => {
    expect(normalizeDbUrl("/data/my-server.db")).toBe("file:/data/my-server.db");
    expect(normalizeDbUrl("/var/lib/app/db.sqlite")).toBe("file:/var/lib/app/db.sqlite");
  });

  it("prefixes a relative path with file:", () => {
    expect(normalizeDbUrl("./data/db.sqlite")).toBe("file:./data/db.sqlite");
    expect(normalizeDbUrl("local.db")).toBe("file:local.db");
    expect(normalizeDbUrl("../db/app.db")).toBe("file:../db/app.db");
  });

  it("prefixes tilde paths with file:", () => {
    expect(normalizeDbUrl("~/app.db")).toBe("file:~/app.db");
  });
});

// ── setupToolHandlers ────────────────────────────────────────

describe("setupToolHandlers", () => {
  function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      TURSO_DATABASE_URL: "file:local.db",
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: undefined,
      GOOGLE_REFRESH_TOKEN: undefined,
      CUSTOM_IMAP_HOST: undefined,
      CUSTOM_IMAP_USER: undefined,
      CUSTOM_IMAP_PASSWORD: undefined,
      CUSTOM_SMTP_HOST: undefined,
      SLACK_WEBHOOK_URL: undefined,
      ...overrides
    } as AppConfig;
  }

  it("setup_status shows unconfigured services when no creds provided", async () => {
    const config = makeConfig();
    const services = { db: { audit: vi.fn(async () => undefined) } } as unknown as Services;

    const handlers = setupToolHandlers(config, services);
    const result = await handlers.setupStatus({});
    const payload = textPayload(result);

    expect(payload.database.configured).toBe(true);
    expect(payload.gmail.configured).toBe(false);
    expect(payload.customMail.imapConfigured).toBe(false);
    expect(payload.customMail.smtpConfigured).toBe(false);
    expect(payload.slack.configured).toBe(false);
  });

  it("setup_status shows configured services when creds are present", async () => {
    const config = makeConfig({
      GOOGLE_REFRESH_TOKEN: "test-refresh-token",
      GOOGLE_CLIENT_ID: "test-client-id",
      CUSTOM_IMAP_HOST: "imap.example.com",
      CUSTOM_IMAP_USER: "user@example.com",
      CUSTOM_IMAP_PASSWORD: "secret123",
      CUSTOM_SMTP_HOST: "smtp.example.com",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/test"
    });
    const services = { db: { audit: vi.fn(async () => undefined) } } as unknown as Services;

    const handlers = setupToolHandlers(config, services);
    const result = await handlers.setupStatus({});
    const payload = textPayload(result);

    expect(payload.gmail.configured).toBe(true);
    expect(payload.gmail.clientIdConfigured).toBe(true);
    expect(payload.customMail.imapConfigured).toBe(true);
    expect(payload.customMail.smtpConfigured).toBe(true);
    expect(payload.slack.configured).toBe(true);
  });

  it("setup_database normalizes a plain path and reconnects", async () => {
    const config = makeConfig();
    const services = {
      db: {
        reconnect: vi.fn(async () => undefined),
        ping: vi.fn(async () => undefined),
        audit: vi.fn(async () => undefined)
      }
    } as unknown as Services;

    const handlers = setupToolHandlers(config, services);
    const result = await handlers.setupDatabase({ url: "/data/pod-db.sqlite" });
    const payload = textPayload(result);

    expect(payload.ok).toBe(true);
    expect(payload.url).toBe("file:/data/pod-db.sqlite");
    expect(services.db.reconnect).toHaveBeenCalledWith(
      "file:/data/pod-db.sqlite",
      undefined,
      undefined
    );
    expect(services.db.ping).toHaveBeenCalledOnce();
  });

  it("setup_database passes libsql:// URLs through unchanged", async () => {
    const config = makeConfig();
    const services = {
      db: {
        reconnect: vi.fn(async () => undefined),
        ping: vi.fn(async () => undefined),
        audit: vi.fn(async () => undefined)
      }
    } as unknown as Services;

    const handlers = setupToolHandlers(config, services);
    const result = await handlers.setupDatabase({
      url: "libsql://my-db.turso.io",
      authToken: "token-abc"
    });
    const payload = textPayload(result);

    expect(payload.ok).toBe(true);
    expect(payload.url).toBe("libsql://my-db.turso.io");
    expect(services.db.reconnect).toHaveBeenCalledWith(
      "libsql://my-db.turso.io",
      "token-abc",
      undefined
    );
  });
});
