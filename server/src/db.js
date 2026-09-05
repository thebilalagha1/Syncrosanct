import { createClient } from "@libsql/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In production, set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (from a free
// Turso database) so data survives restarts/redeploys on free hosts like
// Render, whose local disk is wiped on every restart. Without those env
// vars, this falls back to a local SQLite file for local development.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, "..", "data.db")}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.batch(
  [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,           -- Google 'sub' claim, stable per Google account
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS kv (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    )`,
  ],
  "write"
);

export async function upsertUser({ id, email, name, picture }) {
  await db.execute({
    sql: `INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
    args: [id, email, name || null, picture || null],
  });
  return getUser(id);
}

export async function getUser(id) {
  const result = await db.execute({
    sql: "SELECT id, email, name, picture FROM users WHERE id = ?",
    args: [id],
  });
  return result.rows[0] || null;
}

export async function getValue(userId, key) {
  const result = await db.execute({
    sql: "SELECT value FROM kv WHERE user_id = ? AND key = ?",
    args: [userId, key],
  });
  return result.rows[0] ? result.rows[0].value : null;
}

export async function setValue(userId, key, value) {
  await db.execute({
    sql: `INSERT INTO kv (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [userId, key, value],
  });
}

export default db;
