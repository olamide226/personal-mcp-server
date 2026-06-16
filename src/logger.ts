import { errorMessage } from "./errors.js";

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, data: Record<string, unknown> = {}): void {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...data
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.error(line);
  }
}

export function logError(message: string, error: unknown, data: Record<string, unknown> = {}): void {
  log("error", message, {
    ...data,
    error: errorMessage(error)
  });
}
