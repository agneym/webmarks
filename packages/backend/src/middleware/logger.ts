import type { Context, MiddlewareHandler, Next } from "hono";
import { getPath } from "hono/utils/url";
import type { Logger } from "pino";
import { createLogger } from "../lib/logger";

export const logger = (): MiddlewareHandler => {
  return async (c: Context, next: Next) => {
    const logger = createLogger(c.env);
    c.set("logger", logger);

    const start = performance.now();
    await next();
    const duration = performance.now() - start;

    logger.info({
      method: c.req.method,
      path: getPath(c.req.raw),
      status: c.res.status,
      duration: Math.round(duration * 100) / 100,
    }, "request");
  };
};

declare module "hono" {
  interface ContextVariableMap {
    logger: Logger;
  }
}
