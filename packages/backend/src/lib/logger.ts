import pino, { type Logger } from "pino";

type Env = {
  LOG_LEVEL?: string;
};

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL ?? "info",
    base: undefined,
    // To pretty-print locally, run: wrangler dev | npx pino-pretty
  });
}
