import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton — initialized on first use, not at import time.
// This allows `next build` to complete even without DATABASE_URL set,
// since the build only needs type information from this module.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const client = postgres(url, {
    max: 1, // serverless: keep pool tiny
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });

  _db = drizzle(client, { schema });
  return _db;
}

// Proxy so callers use `db.execute(...)` etc. without calling `getDb()` themselves
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type DB = typeof db;
