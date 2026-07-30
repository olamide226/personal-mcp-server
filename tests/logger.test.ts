import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLogLevel,
  log,
  logDebug,
  logError,
  logInfo,
  logWarn,
  setLogLevel
} from "../src/logger.js";

describe("logger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setLogLevel("info");
    vi.restoreAllMocks();
  });

  function lastLine(): Record<string, unknown> {
    expect(errorSpy).toHaveBeenCalled();
    return JSON.parse(errorSpy.mock.calls.at(-1)![0] as string);
  }

  it("emits structured JSON lines with level, message, time, and data", () => {
    logInfo("Something happened", { tool: "my_tool" });

    const line = lastLine();
    expect(line.level).toBe("info");
    expect(line.message).toBe("Something happened");
    expect(line.tool).toBe("my_tool");
    expect(typeof line.time).toBe("string");
  });

  it("writes everything to stderr, never stdout", () => {
    logDebug("debug line");
    logInfo("info line");
    logWarn("warn line");
    logError("error line", new Error("boom"));

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("filters out debug logs at the default info level", () => {
    expect(getLogLevel()).toBe("info");

    logDebug("hidden");
    expect(errorSpy).not.toHaveBeenCalled();

    logInfo("visible");
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("emits debug logs when the level is lowered", () => {
    setLogLevel("debug");

    logDebug("now visible");
    expect(lastLine().level).toBe("debug");
  });

  it("suppresses everything below error at the error level", () => {
    setLogLevel("error");

    logInfo("hidden");
    logWarn("hidden too");
    expect(errorSpy).not.toHaveBeenCalled();

    logError("shown", new Error("kaput"));
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("includes the error message and extra data in logError", () => {
    logError("Tool failed", new Error("SMTP connection timed out"), {
      tool: "email_confirm_send",
      durationMs: 42
    });

    const line = lastLine();
    expect(line.level).toBe("error");
    expect(line.message).toBe("Tool failed");
    expect(line.error).toBe("SMTP connection timed out");
    expect(line.tool).toBe("email_confirm_send");
    expect(line.durationMs).toBe(42);
  });

  it("handles non-Error thrown values in logError", () => {
    logError("Failed", "string failure");

    expect(lastLine().error).toBe("string failure");
  });
});
