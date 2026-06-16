import { describe, expect, it } from "vitest";
import { assertValidDraft, base64UrlEncode, buildMimeMessage } from "../src/utils/email.js";

describe("email utilities", () => {
  it("rejects drafts without recipients", () => {
    expect(() =>
      assertValidDraft({
        provider: "gmail",
        to: [],
        subject: "Hello",
        text: "Body"
      })
    ).toThrow(/recipient/);
  });

  it("builds MIME messages with fallback sender", () => {
    const message = buildMimeMessage(
      {
        provider: "gmail",
        to: ["person@example.com"],
        subject: "Hello",
        text: "Body"
      },
      "me@example.com"
    );

    expect(message).toContain("From: me@example.com");
    expect(message).toContain("To: person@example.com");
    expect(message).toContain("Subject: Hello");
    expect(base64UrlEncode(message)).not.toContain("+");
  });
});
