import type Database from "better-sqlite3";

const TIME_ZONE = "America/Bogota";
const MIGRATION_NAME = "repair-historical-attendance-order-v1";
const SPILLOVER_MIGRATION_NAME = "repair-historical-attendance-spillover-v2";
const MAX_POST_SHIFT_SPILLOVER_MINUTES = 6 * 60;

type SqliteDatabase = InstanceType<typeof Database>;

type AttendanceRow = {
  id: string;
  employee_id: string;
  type: string;
  occurred_at: number;
};

type ScheduleRow = {
  employee_id: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
};

type LocalDateTime = {
  date: string;
  dayOfWeek: number;
  minutes: number;
};

export type HistoricalAttendanceRepairSummary = {
  skipped: boolean;
  repairedEvents: number;
  repairedPairs: number;
  reversedEvents: number;
  reversedPairs: number;
};

function localDateTime(value: number): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const dayOfWeek = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[get("weekday")];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dayOfWeek,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function minutes(value: string): number {
  const [hours, minutesValue] = value.split(":").map(Number);
  return hours * 60 + minutesValue;
}

function hasValidOvernightCheckout(
  event: AttendanceRow,
  schedules: Map<number, ScheduleRow>,
): boolean {
  const current = localDateTime(event.occurred_at);
  const previousSchedule = schedules.get((current.dayOfWeek + 6) % 7);
  if (!previousSchedule?.start_time || !previousSchedule.end_time) return false;

  const start = minutes(previousSchedule.start_time);
  const end = minutes(previousSchedule.end_time);
  return end < start && current.minutes <= end + MAX_POST_SHIFT_SPILLOVER_MINUTES;
}

function hasLikelyPreviousShiftCheckout(
  event: AttendanceRow,
  schedules: Map<number, ScheduleRow>,
): boolean {
  const current = localDateTime(event.occurred_at);
  const previousSchedule = schedules.get((current.dayOfWeek + 6) % 7);
  if (!previousSchedule?.start_time || !previousSchedule.end_time) return false;

  const start = minutes(previousSchedule.start_time);
  const end = minutes(previousSchedule.end_time);
  if (end < start) {
    return current.minutes <= end + MAX_POST_SHIFT_SPILLOVER_MINUTES;
  }

  const spilloverCutoff = end + MAX_POST_SHIFT_SPILLOVER_MINUTES - 24 * 60;
  return current.minutes <= spilloverCutoff;
}

function repairEvent(
  sqlite: SqliteDatabase,
  event: AttendanceRow,
  repairedType: "check_in" | "check_out",
  reason: string,
  repairedAt: number,
): void {
  sqlite
    .prepare(`
      INSERT INTO attendance_event_repairs (
        event_id,
        original_type,
        repaired_type,
        reason,
        repaired_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(event.id, event.type, repairedType, reason, repairedAt);
  sqlite
    .prepare("UPDATE attendance_events SET type = ? WHERE id = ?")
    .run(repairedType, event.id);
}

function createRepairTables(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_event_repairs (
      event_id TEXT PRIMARY KEY NOT NULL
        REFERENCES attendance_events(id) ON DELETE CASCADE,
      original_type TEXT NOT NULL,
      repaired_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      repaired_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_event_repair_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL
        REFERENCES attendance_events(id) ON DELETE CASCADE,
      from_type TEXT NOT NULL,
      to_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      changed_at INTEGER NOT NULL
    );
  `);
}

function recordRepairAction(
  sqlite: SqliteDatabase,
  eventId: string,
  fromType: string,
  toType: string,
  reason: string,
  changedAt: number,
): void {
  sqlite
    .prepare(`
      INSERT INTO attendance_event_repair_actions (
        event_id,
        from_type,
        to_type,
        reason,
        changed_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(eventId, fromType, toType, reason, changedAt);
  sqlite
    .prepare("UPDATE attendance_events SET type = ? WHERE id = ?")
    .run(toType, eventId);
}

function repairHistoricalSpillovers(
  sqlite: SqliteDatabase,
  now: number,
): { skipped: boolean; reversedEvents: number; reversedPairs: number } {
  const alreadyApplied = sqlite
    .prepare("SELECT 1 FROM app_migrations WHERE name = ?")
    .get(SPILLOVER_MIGRATION_NAME);
  if (alreadyApplied) {
    return { skipped: true, reversedEvents: 0, reversedPairs: 0 };
  }

  const events = sqlite
    .prepare(`
      SELECT id, employee_id, type, occurred_at
      FROM attendance_events
      ORDER BY employee_id ASC, occurred_at ASC, id ASC
    `)
    .all() as AttendanceRow[];
  const schedules = sqlite
    .prepare(`
      SELECT employee_id, day_of_week, start_time, end_time
      FROM weekly_schedules
    `)
    .all() as ScheduleRow[];
  const repairs = sqlite
    .prepare(`
      SELECT event_id, original_type, repaired_type
      FROM attendance_event_repairs
    `)
    .all() as Array<{
      event_id: string;
      original_type: string;
      repaired_type: string;
    }>;

  const schedulesByEmployee = new Map<string, Map<number, ScheduleRow>>();
  for (const schedule of schedules) {
    const employeeSchedules = schedulesByEmployee.get(schedule.employee_id) ?? new Map();
    employeeSchedules.set(schedule.day_of_week, schedule);
    schedulesByEmployee.set(schedule.employee_id, employeeSchedules);
  }
  const repairsByEvent = new Map(repairs.map((repair) => [repair.event_id, repair]));
  const eventsByEmployeeAndDate = new Map<string, AttendanceRow[]>();
  for (const event of events) {
    const key = `${event.employee_id}:${localDateTime(event.occurred_at).date}`;
    const grouped = eventsByEmployeeAndDate.get(key) ?? [];
    grouped.push(event);
    eventsByEmployeeAndDate.set(key, grouped);
  }

  const result = sqlite.transaction(() => {
    let reversedEvents = 0;
    let reversedPairs = 0;

    for (const dayEvents of eventsByEmployeeAndDate.values()) {
      const first = dayEvents[0];
      const firstRepair = first ? repairsByEvent.get(first.id) : undefined;
      if (
        !first ||
        first.type !== "check_in" ||
        firstRepair?.original_type !== "check_out" ||
        firstRepair.repaired_type !== "check_in"
      ) continue;

      const employeeSchedules = schedulesByEmployee.get(first.employee_id) ?? new Map();
      if (!hasLikelyPreviousShiftCheckout(first, employeeSchedules)) continue;

      recordRepairAction(
        sqlite,
        first.id,
        "check_in",
        "check_out",
        "Reverted a historical repair: the event belongs to the previous shift spillover",
        now,
      );
      reversedEvents += 1;

      const second = dayEvents[1];
      const secondRepair = second ? repairsByEvent.get(second.id) : undefined;
      const secondWasHistoricalPair =
        secondRepair?.original_type === "check_in" &&
        secondRepair.repaired_type === "check_out";
      const secondWasCreatedAfterRepair = !secondRepair;
      if (second?.type !== "check_out" || (!secondWasHistoricalPair && !secondWasCreatedAfterRepair)) {
        continue;
      }

      recordRepairAction(
        sqlite,
        second.id,
        "check_out",
        "check_in",
        "Restored the current shift entry after reverting a previous-shift spillover",
        now,
      );
      reversedEvents += 1;
      reversedPairs += 1;
    }

    sqlite
      .prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)")
      .run(SPILLOVER_MIGRATION_NAME, now);
    return { reversedEvents, reversedPairs };
  })();

  return { skipped: false, ...result };
}

export function repairHistoricalAttendanceOrder(
  sqlite: SqliteDatabase,
  now = Date.now(),
): HistoricalAttendanceRepairSummary {
  createRepairTables(sqlite);

  const alreadyApplied = sqlite
    .prepare("SELECT 1 FROM app_migrations WHERE name = ?")
    .get(MIGRATION_NAME);
  let repairedEvents = 0;
  let repairedPairs = 0;
  if (!alreadyApplied) {
    const events = sqlite
    .prepare(`
      SELECT id, employee_id, type, occurred_at
      FROM attendance_events
      ORDER BY employee_id ASC, occurred_at ASC, id ASC
    `)
      .all() as AttendanceRow[];
    const schedules = sqlite
    .prepare(`
      SELECT employee_id, day_of_week, start_time, end_time
      FROM weekly_schedules
    `)
      .all() as ScheduleRow[];

    const schedulesByEmployee = new Map<string, Map<number, ScheduleRow>>();
    for (const schedule of schedules) {
      const employeeSchedules = schedulesByEmployee.get(schedule.employee_id) ?? new Map();
      employeeSchedules.set(schedule.day_of_week, schedule);
      schedulesByEmployee.set(schedule.employee_id, employeeSchedules);
    }

    const eventsByEmployeeAndDate = new Map<string, AttendanceRow[]>();
    for (const event of events) {
      const key = `${event.employee_id}:${localDateTime(event.occurred_at).date}`;
      const grouped = eventsByEmployeeAndDate.get(key) ?? [];
      grouped.push(event);
      eventsByEmployeeAndDate.set(key, grouped);
    }

    const repairsResult = sqlite.transaction(() => {

      for (const dayEvents of eventsByEmployeeAndDate.values()) {
        const first = dayEvents[0];
        if (!first || first.type !== "check_out") continue;

        const employeeSchedules = schedulesByEmployee.get(first.employee_id) ?? new Map();
        if (
          hasValidOvernightCheckout(first, employeeSchedules) ||
          hasLikelyPreviousShiftCheckout(first, employeeSchedules)
        ) continue;

        const second = dayEvents[1];
        const repairedAt = now;
        if (second?.type === "check_in") {
          repairEvent(
            sqlite,
            first,
            "check_in",
            "Leading check_out followed by check_in in the same local attendance date",
            repairedAt,
          );
          repairEvent(
            sqlite,
            second,
            "check_out",
            "Paired with a leading historical check_out repaired as check_in",
            repairedAt,
          );
          repairedEvents += 2;
          repairedPairs += 1;
          continue;
        }

        repairEvent(
          sqlite,
          first,
          "check_in",
          "Historical check_out without an earlier check_in in the same local attendance date",
          repairedAt,
        );
        repairedEvents += 1;
      }

      sqlite
        .prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)")
        .run(MIGRATION_NAME, now);
    })();
    void repairsResult;
  }

  const spilloverRepair = repairHistoricalSpillovers(sqlite, now);
  return {
    skipped: Boolean(alreadyApplied && spilloverRepair.skipped),
    repairedEvents,
    repairedPairs,
    reversedEvents: spilloverRepair.reversedEvents,
    reversedPairs: spilloverRepair.reversedPairs,
  };
}