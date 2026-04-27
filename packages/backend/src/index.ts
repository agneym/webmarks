import { Hono } from "hono";
import { createDrizzle, schema } from "./db";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const db = createDrizzle(c.env.DB);
  const users = await db.select().from(schema.users);
  return c.json({ users });
});

export default app;
