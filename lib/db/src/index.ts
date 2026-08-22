import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const databasePath =
  process.env.SQLITE_DATABASE_PATH ??
  path.resolve(process.cwd(), "data", "attendance.sqlite");

function resetDatabaseIfRequested() {
  if (process.env.RESET_DATABASE?.trim().toLowerCase() !== "yes") {
    return;
  }

  const dataDirectory = path.dirname(databasePath);
  for (const file of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    `${databasePath}-journal`,
  ]) {
    fs.rmSync(file, { force: true });
  }
  fs.rmSync(path.join(dataDirectory, "uploads"), { recursive: true, force: true });
  console.warn(
    "RESET_DATABASE=yes detected: the attendance database and uploaded evidence were cleared before startup.",
  );
}

resetDatabaseIfRequested();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

function tableColumns(table: string): Set<string> {
  return new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

function tableExists(table: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function migrateLegacyExternalIdentitySchema() {
  const legacyIdentityColumn = ["clerk", "user", "id"].join("_");
  if (!tableExists("employees") || !tableColumns("employees").has(legacyIdentityColumn)) {
    return;
  }

  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec(`
      BEGIN;
      ALTER TABLE attendance_events RENAME TO attendance_events_legacy;
      ALTER TABLE employees RENAME TO employees_legacy;
      CREATE TABLE employees (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        document_number TEXT,
        email TEXT,
        phone TEXT,
        job_title TEXT,
        profile_photo_path TEXT,
        role TEXT NOT NULL DEFAULT 'employee',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX employees_username_unique ON employees (username);
      INSERT INTO employees (id, username, password_hash, display_name, role, active, created_at)
      SELECT id, 'legacy-' || substr(id, 1, 8), 'disabled', display_name, role, 0, created_at
      FROM employees_legacy;
      CREATE TABLE attendance_events (
        id TEXT PRIMARY KEY NOT NULL,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
        type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        location TEXT,
        device_label TEXT,
        session_id TEXT,
        login_at INTEGER,
        selfie_path TEXT
      );
      INSERT INTO attendance_events (id, employee_id, type, occurred_at, location, device_label)
      SELECT id, employee_id, type, occurred_at, location, device_label
      FROM attendance_events_legacy;
      DROP TABLE attendance_events_legacy;
      DROP TABLE employees_legacy;
      COMMIT;
    `);
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

migrateLegacyExternalIdentitySchema();
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    document_number TEXT,
    email TEXT,
    phone TEXT,
    job_title TEXT,
    profile_photo_path TEXT,
    role TEXT NOT NULL DEFAULT 'employee',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS employees_username_unique ON employees (username);

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    login_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique ON auth_sessions (token_hash);
  CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);

  CREATE TABLE IF NOT EXISTS login_events (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
    occurred_at INTEGER NOT NULL,
    success INTEGER NOT NULL,
    ip_address TEXT,
    device_label TEXT
  );
  CREATE INDEX IF NOT EXISTS login_events_employee_time_idx ON login_events (employee_id, occurred_at);

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
   CREATE INDEX IF NOT EXISTS attendance_tokens_expiry_idx
     ON attendance_tokens (expires_at);

  CREATE TABLE IF NOT EXISTS qr_display_links (
    id TEXT PRIMARY KEY NOT NULL,
    access_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS qr_display_links_access_hash_unique
    ON qr_display_links (access_hash);
  CREATE INDEX IF NOT EXISTS qr_display_links_expiry_idx
    ON qr_display_links (expires_at);

  CREATE TABLE IF NOT EXISTS attendance_events (
    id TEXT PRIMARY KEY NOT NULL,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    location TEXT,
    device_label TEXT,
    session_id TEXT REFERENCES auth_sessions(id) ON DELETE SET NULL,
    login_at INTEGER,
    selfie_path TEXT
  );
  CREATE INDEX IF NOT EXISTS attendance_events_employee_time_idx
    ON attendance_events (employee_id, occurred_at);
  CREATE INDEX IF NOT EXISTS attendance_events_time_idx
    ON attendance_events (occurred_at);
`);

for (const [column, definition] of [
  ["session_id", "TEXT"],
  ["login_at", "INTEGER"],
  ["selfie_path", "TEXT"],
] as const) {
  if (!tableColumns("attendance_events").has(column)) {
    sqlite.exec(`ALTER TABLE attendance_events ADD COLUMN ${column} ${definition}`);
  }
}
export const db = drizzle(sqlite, { schema });

const QR_CLEANUP_BATCH_SIZE = 100;

/**
 * Removes QR credentials that can no longer be accepted.
 *
 * The cleanup is deliberately bounded so it can run in the server process
 * without holding SQLite's write lock for an unbounded amount of time.
 */
export function cleanupExpiredQrRecords(
  now = new Date(),
  batchSize = QR_CLEANUP_BATCH_SIZE,
): { attendanceTokens: number; displayLinks: number } {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("QR cleanup batch size must be a positive integer");
  }

  const expiresAt = now.getTime();
  return sqlite.transaction(() => {
    const deleteTokens = sqlite.prepare(`
      DELETE FROM attendance_tokens
      WHERE id IN (
        SELECT id
        FROM attendance_tokens
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
        LIMIT ?
      )
    `);
    const deleteDisplayLinks = sqlite.prepare(`
      DELETE FROM qr_display_links
      WHERE id IN (
        SELECT id
        FROM qr_display_links
        WHERE expires_at <= ?
        ORDER BY expires_at ASC
        LIMIT ?
      )
    `);

    const attendanceTokens = deleteTokens.run(expiresAt, batchSize).changes;
    const displayLinks = deleteDisplayLinks.run(expiresAt, batchSize).changes;
    return { attendanceTokens, displayLinks };
  })();
}

export * from "./schema";
