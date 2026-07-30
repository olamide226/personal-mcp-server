import { errorMessage } from "./errors.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let minLevel: LogLevel = "info";

/** Set the minimum level a log line must have to be emitted. */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

/**
 * Emit a structured JSON log line. Everything goes to stderr so the stdout
 * channel stays clean for the stdio MCP transport.
 */
export function log(level: LogLevel, message: string, data: Record<string, unknown> = {}): void {
  if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[minLevel]) {
    return;
  }
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...data
  };
  console.error(JSON.stringify(payload));
}

export function logDebug(message: string, data: Record<string, unknown> = {}): void {
  log("debug", message, data);
}

export function logInfo(message: string, data: Record<string, unknown> = {}): void {
  log("info", message, data);
}

export function logWarn(message: string, data: Record<string, unknown> = {}): void {
  log("warn", message, data);
}

export function logError(message: string, error: unknown, data: Record<string, unknown> = {}): void {
  log("error", message, {
    ...data,
    error: errorMessage(error)
  });
}
