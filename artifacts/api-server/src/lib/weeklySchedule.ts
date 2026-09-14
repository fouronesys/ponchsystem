import { db, weeklySchedulesTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const DAYS_IN_WEEK = 7;
export const MAX_POST_SHIFT_SPILLOVER_MINUTES = 6 * 60;

export type WeeklyScheduleDayInput = {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  mealStart: string | null;
  mealEnd: string | null;
};

export type AttendanceTimingStatus =
  | "on_time"
  | "early"
  | "late"
  | "outside_shift"
  | "day_off";

function emptyDay(employeeId: string, dayOfWeek: number) {
  return {
    id: randomUUID(),
    employeeId,
    dayOfWeek,
    startTime: null,
    endTime: null,
    mealStart: null,
    mealEnd: null,
  };
}

export async function ensureWeeklySchedule(employeeId: string): Promise<void> {
  db.transaction((tx) => {
    tx
      .insert(weeklySchedulesTable)
      .values(Array.from({ length: DAYS_IN_WEEK }, (_, dayOfWeek) => emptyDay(employeeId, dayOfWeek)))
      .onConflictDoNothing()
      .run();
  });
}

export async function getWeeklySchedule(employeeId: string) {
  await ensureWeeklySchedule(employeeId);
  const days = await db
    .select({
      dayOfWeek: weeklySchedulesTable.dayOfWeek,
      startTime: weeklySchedulesTable.startTime,
      endTime: weeklySchedulesTable.endTime,
      mealStart: weeklySchedulesTable.mealStart,
      mealEnd: weeklySchedulesTable.mealEnd,
    })
    .from(weeklySchedulesTable)
    .where(eq(weeklySchedulesTable.employeeId, employeeId))
    .orderBy(asc(weeklySchedulesTable.dayOfWeek));
  return { employeeId, days };
}

export function minutes(value: string): number {
  const [hours, minutesValue] = value.split(":").map(Number);
  return hours * 60 + minutesValue;
}

function bogotaParts(value: Date): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const dayOfWeek = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[weekday ?? "Sun"];
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 0),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 0),
    dayOfWeek,
    minutes: hour * 60 + minute,
  };
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarDate(value: Date): string {
  const current = bogotaParts(value);
  return formatCalendarDate(current.year, current.month, current.day);
}

function previousCalendarDate(value: Date): string {
  const current = bogotaParts(value);
  const previous = new Date(Date.UTC(current.year, current.month - 1, current.day - 1));
  return previous.toISOString().slice(0, 10);
}

type ScheduleDayWithHours = Pick<WeeklyScheduleDayInput, "dayOfWeek" | "startTime" | "endTime">;

function previousOvernightSchedule<T extends ScheduleDayWithHours>(
  current: ReturnType<typeof bogotaParts>,
  days: Array<T>,
): T | undefined {
  const previous = days.find((day) => day.dayOfWeek === (current.dayOfWeek + 6) % DAYS_IN_WEEK);
  if (
    previous?.startTime &&
    previous.endTime &&
    minutes(previous.endTime) < minutes(previous.startTime) &&
    current.minutes <= minutes(previous.endTime)
  ) {
    return previous;
  }
  return undefined;
}

export function attendanceDayForDate(
  date: Date,
  days: Array<ScheduleDayWithHours>,
): string {
  return previousOvernightSchedule(bogotaParts(date), days)
    ? previousCalendarDate(date)
    : calendarDate(date);
}

export function attendanceTimingStatus(
  type: "check_in" | "check_out",
  occurredAt: Date,
  scheduleDay: Pick<WeeklyScheduleDayInput, "startTime" | "endTime"> | null | undefined,
): AttendanceTimingStatus {
  if (!scheduleDay?.startTime || !scheduleDay.endTime) return "day_off";
  const parts = bogotaParts(occurredAt);
  const actual = parts.minutes;
  const start = minutes(scheduleDay.startTime);
  const end = minutes(scheduleDay.endTime);
  const overnight = end < start;
  const normalizedActual = overnight && actual <= end ? actual + 24 * 60 : actual;
  const normalizedEnd = overnight ? end + 24 * 60 : end;
  if (type === "check_in") {
    if (normalizedActual < start) return "early";
    if (normalizedActual === start) return "on_time";
    if (normalizedActual <= normalizedEnd) return "late";
    return "outside_shift";
  }
  if (normalizedActual < start || normalizedActual > normalizedEnd) return "outside_shift";
  if (normalizedActual < normalizedEnd) return "early";
  if (normalizedActual === normalizedEnd) return "on_time";
  return "late";
}

export function scheduleDayForDate<T extends ScheduleDayWithHours>(
  days: T[],
  date: Date,
): T | undefined {
  const current = bogotaParts(date);
  const previous = previousOvernightSchedule(current, days);
  if (previous) return previous as T;

  const sameDay = days.find((day) => day.dayOfWeek === current.dayOfWeek);
  return sameDay;
}

export function scheduleDayStartingOnDate<T extends ScheduleDayWithHours>(
  days: T[],
  date: Date,
): T | undefined {
  const current = bogotaParts(date);
  return days.find((day) => day.dayOfWeek === current.dayOfWeek);
}

export function isPreviousShiftSpillover(
  date: Date,
  days: Array<Pick<WeeklyScheduleDayInput, "dayOfWeek" | "startTime" | "endTime">>,
): boolean {
  const current = bogotaParts(date);
  const previous = days.find((day) => day.dayOfWeek === (current.dayOfWeek + 6) % DAYS_IN_WEEK);
  if (!previous?.startTime || !previous.endTime) return false;

  const previousStart = minutes(previous.startTime);
  const previousEnd = minutes(previous.endTime);
  if (previousEnd < previousStart) {
    return current.minutes <= previousEnd;
  }

  const spilloverCutoff = previousEnd + MAX_POST_SHIFT_SPILLOVER_MINUTES - 24 * 60;
  return current.minutes <= spilloverCutoff;
}

export function validateWeeklySchedule(days: WeeklyScheduleDayInput[]): string | null {
  if (days.length !== DAYS_IN_WEEK) {
    return "Debes configurar los siete días de la semana.";
  }

  const configuredDays = new Set<number>();
  for (const day of days) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek >= DAYS_IN_WEEK) {
      return "El día de la semana no es válido.";
    }
    if (configuredDays.has(day.dayOfWeek)) {
      return "No puedes repetir un día de la semana.";
    }
    configuredDays.add(day.dayOfWeek);

    const hasStart = Boolean(day.startTime);
    const hasEnd = Boolean(day.endTime);
    if (hasStart !== hasEnd) {
      return "Cada día laborable necesita hora de entrada y salida.";
    }
    const hasMealStart = Boolean(day.mealStart);
    const hasMealEnd = Boolean(day.mealEnd);
    if (hasMealStart !== hasMealEnd) {
      return "La comida necesita hora de inicio y fin.";
    }
    if (!hasStart && (hasMealStart || hasMealEnd)) {
      return "No puedes registrar comida en un día libre.";
    }
    if (!hasStart || !day.startTime || !day.endTime) continue;

    if (minutes(day.startTime) === minutes(day.endTime)) {
      return "La entrada y la salida no pueden ser iguales.";
    }
    if (!hasMealStart || !day.mealStart || !day.mealEnd) continue;

    const start = minutes(day.startTime);
    const end = minutes(day.endTime);
    const overnight = end < start;
    const shiftEnd = overnight ? end + 24 * 60 : end;
    const mealStart = minutes(day.mealStart) < start ? minutes(day.mealStart) + 24 * 60 : minutes(day.mealStart);
    let mealEnd = minutes(day.mealEnd) < start ? minutes(day.mealEnd) + 24 * 60 : minutes(day.mealEnd);
    if (mealEnd <= mealStart) mealEnd += 24 * 60;
    if (
      mealStart <= start ||
      mealEnd <= mealStart ||
      mealEnd >= shiftEnd
    ) {
      return "La comida debe estar completamente dentro de la jornada, incluso en turnos de madrugada.";
    }
  }

  return configuredDays.size === DAYS_IN_WEEK ? null : "Faltan días por configurar.";
}

export async function replaceWeeklySchedule(employeeId: string, days: WeeklyScheduleDayInput[]) {
  db.transaction((tx) => {
    replaceWeeklyScheduleInTransaction(tx, employeeId, days);
  });
  return getWeeklySchedule(employeeId);
}

function replaceWeeklyScheduleInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  employeeId: string,
  days: WeeklyScheduleDayInput[],
) {
  tx
    .insert(weeklySchedulesTable)
    .values(Array.from({ length: DAYS_IN_WEEK }, (_, dayOfWeek) => emptyDay(employeeId, dayOfWeek)))
    .onConflictDoNothing()
    .run();
  for (const day of days) {
    tx
      .update(weeklySchedulesTable)
      .set({
        startTime: day.startTime,
        endTime: day.endTime,
        mealStart: day.mealStart,
        mealEnd: day.mealEnd,
      })
      .where(and(
        eq(weeklySchedulesTable.employeeId, employeeId),
        eq(weeklySchedulesTable.dayOfWeek, day.dayOfWeek),
      ))
      .run();
  }
}

export async function replaceWeeklySchedules(
  employeeIds: string[],
  days: WeeklyScheduleDayInput[],
): Promise<void> {
  db.transaction((tx) => {
    for (const employeeId of employeeIds) {
      replaceWeeklyScheduleInTransaction(tx, employeeId, days);
    }
  });
}