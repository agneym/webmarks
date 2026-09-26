import { betterAuth, APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { bearer, multiSession, openAPI } from "better-auth/plugins";
import { v7 as uuidv7 } from "uuid";
import { createDrizzle } from "../db";

function isOwnerEmail(email: string | undefined | null, ownerEmail: string): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

/**
 * Creates a Better Auth instance scoped to the current request.
 *
 * Called per-request because the D1 binding comes from `c.env`.
 * Better Auth handles session cookies, password hashing, and
 * social OAuth providers automatically.
 *
 * Access is restricted to OWNER_EMAIL — no other account may sign up or sign in.
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
    advanced: {
      database: {
        generateId: () => uuidv7(),
      },
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
    // Allow cross-origin requests from web app, chrome extensions, etc.
    trustedOrigins: [env.WEB_APP_URL, "chrome-extension://*"],

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    // Block non-owner account creation (covers email sign-up and OAuth).
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isOwnerEmail(user.email, env.OWNER_EMAIL)) {
              throw APIError.from("FORBIDDEN", {
                code: "OWNER_ONLY",
                message: "Only the site owner can create an account",
              });
            }
          },
        },
      },
    },

    // Block non-owner email/password sign-in before credentials are checked.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
          const email =
            typeof ctx.body === "object" && ctx.body && "email" in ctx.body
              ? String((ctx.body as { email?: unknown }).email ?? "")
              : "";
          if (!isOwnerEmail(email, env.OWNER_EMAIL)) {
            throw APIError.from("FORBIDDEN", {
              code: "OWNER_ONLY",
              message: "Only the site owner can sign in",
            });
          }
        }
      }),
    },

    plugins: [
      bearer(), // Accept Authorization: Bearer <token> for non-browser clients
      multiSession({ maximumSessions: 5 }), // Multiple devices logged in at once
      deviceAuthorization(), // RFC 8628 device authorization flow (CLI login)
      openAPI(), // Auto-generated API docs at /api/auth/reference
    ],
  });

export type Auth = ReturnType<typeof createAuth>;
