import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import { repairHistoricalAttendanceOrder } from "./historical-attendance-repair";

function createDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE attendance_events (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      type TEXT NOT NULL,
      occurred_at INTEGER NOT NULL
    );
    CREATE TABLE weekly_schedules (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT,
      end_time TEXT
    );
  `);
  return sqlite;
}

function eventType(sqlite: Database.Database, eventId: string): string | undefined {
  return (sqlite
    .prepare("SELECT type FROM attendance_events WHERE id = ?")
    .get(eventId) as { type?: string } | undefined)?.type;
}

test("repara una salida histórica aislada como entrada", () => {
  const sqlite = createDatabase();
  const employeeId = "employee-1";
  sqlite
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-1", employeeId, 2, "16:00", "23:59");
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-1", employeeId, "check_out", Date.parse("2026-08-26T20:01:00Z"));

  const summary = repairHistoricalAttendanceOrder(sqlite, 123);

  assert.deepEqual(summary, {
    skipped: false,
    repairedEvents: 1,
    repairedPairs: 0,
    reversedEvents: 0,
    reversedPairs: 0,
  });
  assert.equal(eventType(sqlite, "event-1"), "check_in");
  assert.equal(
    (sqlite
      .prepare("SELECT original_type, repaired_type FROM attendance_event_repairs WHERE event_id = ?")
      .get("event-1") as { original_type?: string } | undefined)?.original_type,
    "check_out",
  );
  assert.deepEqual(repairHistoricalAttendanceOrder(sqlite, 456), {
    skipped: true,
    repairedEvents: 0,
    repairedPairs: 0,
    reversedEvents: 0,
    reversedPairs: 0,
  });
  sqlite.close();
});

test("repara un par invertido sin tocar una salida válida de turno nocturno", () => {
  const sqlite = createDatabase();
  const employeeId = "employee-2";
  sqlite
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-2", employeeId, 2, "16:00", "23:59");
  sqlite
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-3", employeeId, 3, "16:00", "23:59");
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-2a", employeeId, "check_out", Date.parse("2026-08-26T20:01:00Z"));
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-2b", employeeId, "check_in", Date.parse("2026-08-26T22:00:00Z"));

  const summary = repairHistoricalAttendanceOrder(sqlite, 123);

  assert.deepEqual(summary, {
    skipped: false,
    repairedEvents: 2,
    repairedPairs: 1,
    reversedEvents: 0,
    reversedPairs: 0,
  });
  assert.equal(eventType(sqlite, "event-2a"), "check_in");
  assert.equal(eventType(sqlite, "event-2b"), "check_out");
  sqlite.close();

  const overnight = createDatabase();
  overnight
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-overnight", "employee-3", 2, "16:00", "06:00");
  overnight
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-3", "employee-3", "check_out", Date.parse("2026-08-26T05:01:00Z"));

  assert.deepEqual(repairHistoricalAttendanceOrder(overnight, 123), {
    skipped: false,
    repairedEvents: 0,
    repairedPairs: 0,
    reversedEvents: 0,
    reversedPairs: 0,
  });
  assert.equal(eventType(overnight, "event-3"), "check_out");
  overnight.close();

  const normalSpillover = createDatabase();
  normalSpillover
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-spillover-a", "employee-5", 2, "16:00", "23:59");
  normalSpillover
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-spillover-b", "employee-5", 3, "16:00", "23:59");
  normalSpillover
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-5", "employee-5", "check_out", Date.parse("2026-08-26T05:04:00Z"));

  assert.deepEqual(repairHistoricalAttendanceOrder(normalSpillover, 123), {
    skipped: false,
    repairedEvents: 0,
    repairedPairs: 0,
    reversedEvents: 0,
    reversedPairs: 0,
  });
  assert.equal(eventType(normalSpillover, "event-5"), "check_out");
  normalSpillover.close();
});

test("revierte la primera reparación cuando era una salida de madrugada", () => {
  const sqlite = createDatabase();
  const employeeId = "employee-4";
  sqlite
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-4a", employeeId, 2, "16:00", "23:59");
  sqlite
    .prepare("INSERT INTO weekly_schedules VALUES (?, ?, ?, ?, ?)")
    .run("schedule-4b", employeeId, 3, "16:00", "23:59");
  sqlite.exec(`
    CREATE TABLE app_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL);
    CREATE TABLE attendance_event_repairs (
      event_id TEXT PRIMARY KEY NOT NULL,
      original_type TEXT NOT NULL,
      repaired_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      repaired_at INTEGER NOT NULL
    );
  `);
  sqlite
    .prepare("INSERT INTO app_migrations VALUES (?, ?)")
    .run("repair-historical-attendance-order-v1", 100);
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-4a", employeeId, "check_in", Date.parse("2026-08-26T05:04:00Z"));
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-4b", employeeId, "check_out", Date.parse("2026-08-26T21:12:00Z"));
  sqlite
    .prepare("INSERT INTO attendance_event_repairs VALUES (?, ?, ?, ?, ?)")
    .run(
      "event-4a",
      "check_out",
      "check_in",
      "Historical check_out without an earlier check_in in the same local attendance date",
      100,
    );

  assert.deepEqual(repairHistoricalAttendanceOrder(sqlite, 123), {
    skipped: false,
    repairedEvents: 0,
    repairedPairs: 0,
    reversedEvents: 2,
    reversedPairs: 1,
  });
  assert.equal(eventType(sqlite, "event-4a"), "check_out");
  assert.equal(eventType(sqlite, "event-4b"), "check_in");
  sqlite.close();
});