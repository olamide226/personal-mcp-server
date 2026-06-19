import { randomUUID } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import type { AppConfig } from "../config.js";
import { NotFoundError } from "../errors.js";
import type { AuditEvent, EmailDraft, JsonRecord, PreparedEmail, SoulDoc } from "../types.js";

export class DatabaseService {
  private client: Client;
  private readonly config: AppConfig;
  private readonly confirmationTtlSeconds: number;

  constructor(config: AppConfig, client?: Client) {
    this.config = config;
    this.client =
      client ??
      createClient({
        url: config.TURSO_DATABASE_URL,
        authToken: config.TURSO_AUTH_TOKEN,
        syncUrl: config.TURSO_SYNC_URL,
        syncInterval: config.TURSO_SYNC_INTERVAL_MS
      });
    this.confirmationTtlSeconds = config.EMAIL_CONFIRMATION_TTL_SECONDS;
  }

  async init(): Promise<void> {
    await this.client.batch(
      [
        `CREATE TABLE IF NOT EXISTS soul_docs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          source TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS send_confirmations (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          draft_json TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          success INTEGER NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_soul_docs_updated_at ON soul_docs(updated_at)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_send_confirmations_expires_at ON send_confirmations(expires_at)`,
        `CREATE TABLE IF NOT EXISTS runtime_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`
      ],
      "write"
    );
  }

  /** Close the existing client and create a new one with updated config. Re-runs DDL. */
  async reconnect(
    url?: string,
    authToken?: string,
    syncUrl?: string
  ): Promise<void> {
    try {
      this.client.close();
    } catch {
      // close() is sync in libSQL — ignore errors from an already-closed client.
    }
    this.client = createClient({
      url: url ?? this.config.TURSO_DATABASE_URL,
      authToken: authToken ?? this.config.TURSO_AUTH_TOKEN,
      syncUrl: syncUrl ?? this.config.TURSO_SYNC_URL,
      syncInterval: this.config.TURSO_SYNC_INTERVAL_MS
    });
    await this.init();
  }

  /** Lightweight connection check. Throws if the database is unreachable. */
  async ping(): Promise<void> {
    await this.client.execute("SELECT 1");
  }

  // ── Runtime config persistence ──────────────────────────

  /** Load all persisted runtime config overrides. */
  async getRuntimeConfig(): Promise<Record<string, string>> {
    const result = await this.client.execute("SELECT key, value FROM runtime_config");
    const config: Record<string, string> = {};
    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      config[String(r.key)] = String(r.value);
    }
    return config;
  }

  /** Persist a single runtime config key-value pair. */
  async setRuntimeConfig(key: string, value: string): Promise<void> {
    await this.client.execute({
      sql: "INSERT INTO runtime_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, value]
    });
  }

  /** Delete a single runtime config key. */
  async deleteRuntimeConfig(key: string): Promise<void> {
    await this.client.execute({
      sql: "DELETE FROM runtime_config WHERE key = ?",
      args: [key]
    });
  }

  /** Clear all persisted runtime config. */
  async clearRuntimeConfig(): Promise<void> {
    await this.client.execute("DELETE FROM runtime_config");
  }

  // ── Soul docs ─────────────────────────────────────────

  async getSoulDocs(input: {
    query?: string;
    tag?: string;
    limit: number;
  }): Promise<SoulDoc[]> {
    const where: string[] = [];
    const args: string[] = [];

    if (input.query) {
      where.push("(title LIKE ? OR content LIKE ? OR source LIKE ?)");
      const pattern = `%${input.query}%`;
      args.push(pattern, pattern, pattern);
    }

    if (input.tag) {
      where.push("tags_json LIKE ?");
      args.push(`%"${input.tag}"%`);
    }

    const result = await this.client.execute({
      sql: `SELECT id, title, content, tags_json, source, metadata_json, created_at, updated_at
            FROM soul_docs
            ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY updated_at DESC
            LIMIT ?`,
      args: [...args, input.limit]
    });

    return result.rows.map((row) => rowToSoulDoc(row as Record<string, unknown>));
  }

  async writeSoulDoc(input: {
    id?: string;
    title: string;
    content: string;
    tags?: string[];
    source?: string;
    metadata?: JsonRecord;
  }): Promise<SoulDoc> {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = input.id
      ? await this.client.execute({
          sql: "SELECT created_at FROM soul_docs WHERE id = ?",
          args: [id]
        })
      : undefined;
    const createdAt = existing?.rows[0]?.created_at?.toString() ?? now;

    await this.client.execute({
      sql: `INSERT INTO soul_docs (id, title, content, tags_json, source, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              content = excluded.content,
              tags_json = excluded.tags_json,
              source = excluded.source,
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at`,
      args: [
        id,
        input.title,
        input.content,
        JSON.stringify(input.tags ?? []),
        input.source ?? null,
        JSON.stringify(input.metadata ?? {}),
        createdAt,
        now
      ]
    });

    return {
      id,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      source: input.source,
      metadata: input.metadata ?? {},
      createdAt,
      updatedAt: now
    };
  }

  async createConfirmation(draft: EmailDraft): Promise<PreparedEmail> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + this.confirmationTtlSeconds * 1000).toISOString();

    await this.client.execute({
      sql: `INSERT INTO send_confirmations (id, provider, draft_json, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [id, draft.provider, JSON.stringify(draft), expiresAt]
    });

    return {
      ...draft,
      id,
      expiresAt
    };
  }

  async consumeConfirmation(id: string): Promise<EmailDraft> {
    const now = new Date().toISOString();
    const result = await this.client.execute({
      sql: `SELECT draft_json, expires_at, used_at
            FROM send_confirmations
            WHERE id = ?`,
      args: [id]
    });

    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new NotFoundError("Confirmation token not found.");
    }
    if (row.used_at) {
      throw new NotFoundError("Confirmation token has already been used.");
    }
    if (String(row.expires_at) < now) {
      throw new NotFoundError("Confirmation token has expired.");
    }

    await this.client.execute({
      sql: "UPDATE send_confirmations SET used_at = ? WHERE id = ?",
      args: [now, id]
    });

    return JSON.parse(String(row.draft_json)) as EmailDraft;
  }

  async audit(event: AuditEvent): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO audit_log (id, tool_name, success, metadata_json, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        event.toolName,
        event.success ? 1 : 0,
        JSON.stringify(event.metadata ?? {}),
        event.error ?? null,
        new Date().toISOString()
      ]
    });
  }
}

function rowToSoulDoc(row: Record<string, unknown>): SoulDoc {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    tags: safeJson(row.tags_json, []),
    source: row.source ? String(row.source) : undefined,
    metadata: safeJson(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
