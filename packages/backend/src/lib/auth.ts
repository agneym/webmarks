import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDrizzle } from "../db";

/**
 * Creates a Better Auth instance scoped to the current request.
 *
 * Called per-request because the D1 binding comes from `c.env`.
 * Better Auth handles session cookies, password hashing, and
 * social OAuth providers automatically.
 */
export const createAuth = (env: CloudflareBindings) =>
  betterAuth({
    database: drizzleAdapter(createDrizzle(env.webmarks), {
      provider: "sqlite",
    }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 10, max: 3 },
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
  });

export type Auth = ReturnType<typeof createAuth>;
