import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { CustomMailService } from "../src/services/custom-mail.js";

describe("CustomMailService", () => {
  it("allows the default account to be configured at runtime", () => {
    const service = new CustomMailService(loadConfig({}));

    service.addOrUpdateAccount({
      label: "default",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "me@example.com",
        password: "secret"
      },
      defaultFrom: "me@example.com"
    });

    expect(service.listAccountLabels()).toEqual([
      {
        label: "default",
        imapConfigured: false,
        smtpConfigured: true,
        defaultFrom: "me@example.com"
      }
    ]);
  });
});
