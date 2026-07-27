import { describe, expect, it, vi } from "vitest";
import { toolHandlers } from "../src/tools.js";
import type { Services } from "../src/runtime.js";

function textPayload(result: Awaited<ReturnType<ReturnType<typeof toolHandlers>["emailPrepareSend"]>>) {
  return JSON.parse(result.content[0].text);
}

describe("toolHandlers", () => {
  it("prepares email instead of sending directly", async () => {
    const services = {
      db: {
        createConfirmation: vi.fn(async (draft) => ({
          ...draft,
          id: "00000000-0000-4000-8000-000000000000",
          expiresAt: "2030-01-01T00:00:00.000Z"
        })),
        audit: vi.fn(async () => undefined)
      },
      emailSender: {
        send: vi.fn()
      }
    } as unknown as Services;

    const handlers = toolHandlers(services);
    const result = await handlers.emailPrepareSend({
      provider: "smtp",
      to: ["person@example.com"],
      subject: "Hello",
      text: "Body"
    });

    expect(textPayload(result).confirmation.id).toBe("00000000-0000-4000-8000-000000000000");
    expect(services.emailSender.send).not.toHaveBeenCalled();
  });

  it("confirms and sends a prepared email", async () => {
    const services = {
      db: {
        claimConfirmation: vi.fn(async () => ({
          draft: { provider: "smtp", to: ["person@example.com"], subject: "Hello", text: "Body" },
          claimToken: "sending:test"
        })),
        completeConfirmation: vi.fn(async () => undefined),
        releaseConfirmation: vi.fn(async () => undefined),
        audit: vi.fn(async () => undefined)
      },
      emailSender: {
        send: vi.fn(async () => ({ messageId: "abc" }))
      }
    } as unknown as Services;

    const handlers = toolHandlers(services);
    const result = await handlers.emailConfirmSend({
      confirmationId: "00000000-0000-4000-8000-000000000000"
    });

    expect(textPayload(result).sent).toBe(true);
    expect(services.emailSender.send).toHaveBeenCalledOnce();
    expect(services.db.completeConfirmation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000000",
      "sending:test"
    );
  });

  it("releases a confirmation after a known send failure", async () => {
    const services = {
      db: {
        claimConfirmation: vi.fn(async () => ({
          draft: { provider: "smtp", to: ["person@example.com"], subject: "Hello", text: "Body" },
          claimToken: "sending:test"
        })),
        completeConfirmation: vi.fn(async () => undefined),
        releaseConfirmation: vi.fn(async () => undefined),
        audit: vi.fn(async () => undefined)
      },
      emailSender: {
        send: vi.fn(async () => { throw new Error("SMTP connection timed out"); })
      }
    } as unknown as Services;

    const result = await toolHandlers(services).emailConfirmSend({
      confirmationId: "00000000-0000-4000-8000-000000000000"
    });

    expect(textPayload(result).error.message).toBe("SMTP connection timed out");
    expect(services.db.releaseConfirmation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000000",
      "sending:test"
    );
    expect(services.db.completeConfirmation).not.toHaveBeenCalled();
  });
});
