import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/services/database.js";

describe("DatabaseService", () => {
  it("writes and reads soul docs", async () => {
    const db = new DatabaseService(
      loadConfig({
        TURSO_DATABASE_URL: ":memory:"
      })
    );
    await db.init();

    const created = await db.writeSoulDoc({
      title: "Operating principles",
      content: "Move fast without losing the audit trail.",
      tags: ["principles"],
      metadata: { priority: 1 }
    });

    const docs = await db.getSoulDocs({ query: "audit", tag: "principles", limit: 10 });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: created.id,
      title: "Operating principles",
      tags: ["principles"],
      metadata: { priority: 1 }
    });
  });

  it("creates and consumes confirmation tokens exactly once", async () => {
    const db = new DatabaseService(
      loadConfig({
        TURSO_DATABASE_URL: ":memory:",
        EMAIL_CONFIRMATION_TTL_SECONDS: "60"
      })
    );
    await db.init();

    const prepared = await db.createConfirmation({
      provider: "smtp",
      to: ["person@example.com"],
      subject: "Hello",
      text: "Body"
    });

    const draft = await db.consumeConfirmation(prepared.id);
    expect(draft.subject).toBe("Hello");
    await expect(db.consumeConfirmation(prepared.id)).rejects.toThrow(/already been used/);
  });
});
