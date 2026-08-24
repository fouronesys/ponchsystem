import { db, weeklySchedulesTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const DAYS_IN_WEEK = 7;

export type WeeklyScheduleDayInput = {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  mealStart: string | null;
  mealEnd: string | null;
};

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

function minutes(value: string): number {
  const [hours, minutesValue] = value.split(":").map(Number);
  return hours * 60 + minutesValue;
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

    if (minutes(day.startTime) >= minutes(day.endTime)) {
      return "La entrada debe ser anterior a la salida.";
    }
    if (!hasMealStart || !day.mealStart || !day.mealEnd) continue;

    if (
      minutes(day.mealStart) >= minutes(day.mealEnd) ||
      minutes(day.mealStart) <= minutes(day.startTime) ||
      minutes(day.mealEnd) >= minutes(day.endTime)
    ) {
      return "La comida debe estar completamente dentro de la jornada.";
    }
  }

  return configuredDays.size === DAYS_IN_WEEK ? null : "Faltan días por configurar.";
}

export async function replaceWeeklySchedule(employeeId: string, days: WeeklyScheduleDayInput[]) {
  db.transaction((tx) => {
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
  });
  return getWeeklySchedule(employeeId);
}