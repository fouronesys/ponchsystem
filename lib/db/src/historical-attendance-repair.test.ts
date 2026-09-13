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
    .run("event-1", employeeId, "check_out", Date.parse("2026-08-26T05:01:00Z"));

  const summary = repairHistoricalAttendanceOrder(sqlite, 123);

  assert.deepEqual(summary, { skipped: false, repairedEvents: 1, repairedPairs: 0 });
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
    .run("event-2a", employeeId, "check_out", Date.parse("2026-08-26T05:01:00Z"));
  sqlite
    .prepare("INSERT INTO attendance_events VALUES (?, ?, ?, ?)")
    .run("event-2b", employeeId, "check_in", Date.parse("2026-08-26T20:00:00Z"));

  const summary = repairHistoricalAttendanceOrder(sqlite, 123);

  assert.deepEqual(summary, { skipped: false, repairedEvents: 2, repairedPairs: 1 });
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
  });
  assert.equal(eventType(overnight, "event-3"), "check_out");
  overnight.close();
});