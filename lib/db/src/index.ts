import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const databasePath =
  process.env.SQLITE_DATABASE_PATH ??
  path.resolve(process.cwd(), "data", "attendance.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY NOT NULL,
    clerk_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS employees_clerk_user_id_unique
    ON employees (clerk_user_id);

  CREATE TABLE IF NOT EXISTS attendance_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL,
    encrypted_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS attendance_tokens_hash_unique
    ON attendance_tokens (token_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS attendance_tokens_one_active_unique
    ON attendance_tokens (is_active) WHERE is_active = 1;
  CREATE INDEX IF NOT EXISTS attendance_tokens_validation_idx
    ON attendance_tokens (token_hash, is_active, expires_at);

  CREATE TABLE IF NOT EXISTS attendance_events (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    location TEXT,
    device_label TEXT
  );
  CREATE INDEX IF NOT EXISTS attendance_events_employee_time_idx
    ON attendance_events (employee_id, occurred_at);
  CREATE INDEX IF NOT EXISTS attendance_events_time_idx
    ON attendance_events (occurred_at);
`);
export const db = drizzle(sqlite, { schema });

export * from "./schema";
