import {
  attendanceEventsTable,
  db,
  employeesTable,
  type Employee,
} from "@workspace/db";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  attendanceTimingStatus,
  getWeeklySchedule,
  scheduleDayForDate,
  type AttendanceTimingStatus,
} from "./weeklySchedule";

const TIME_ZONE = "America/Bogota";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PayrollReportDay = {
  date: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  workedMinutes: number;
  state: "worked" | "absent" | "incomplete" | "day_off";
  checkInTiming: AttendanceTimingStatus | null;
  checkOutTiming: AttendanceTimingStatus | null;
};

export type PayrollReportEmployee = {
  id: string;
  displayName: string;
  documentNumber: string | null;
  jobTitle: string | null;
  expectedDays: number;
  absenceDays: number;
  incompleteDays: number;
  workedMinutes: number;
  lateEntries: number;
  outsideShiftEvents: number;
  days: PayrollReportDay[];
};

export type PayrollAttendanceReport = {
  version: "1.0";
  timezone: string;
  startDate: string;
  endDate: string;
  generatedAt: Date;
  employees: PayrollReportEmployee[];
  totals: {
    employeeCount: number;
    expectedDays: number;
    absenceDays: number;
    incompleteDays: number;
    workedMinutes: number;
    lateEntries: number;
    outsideShiftEvents: number;
  };
};

export type PayrollReportRange = {
  startDate: string;
  endDate: string;
  startAt: Date;
  endExclusive: Date;
};

function dateAtBogotaMidnight(date: string): Date {
  return new Date(`${date}T00:00:00-05:00`);
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function reportDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate; current = nextDate(current)) {
    dates.push(current);
  }
  return dates;
}

function reportDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const piece = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${piece("year")}-${piece("month")}-${piece("day")}`;
}

function timeAtBogota(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function duration(value: number): string {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function timingLabel(value: AttendanceTimingStatus | null): string | null {
  const labels: Record<AttendanceTimingStatus, string> = {
    on_time: "A tiempo",
    early: "Temprano",
    late: "Tardío",
    outside_shift: "Fuera de jornada",
    day_off: "Día libre",
  };
  return value ? labels[value] : null;
}

function dayStateLabel(value: PayrollReportDay["state"]): string {
  return {
    worked: "Registrado",
    absent: "Ausente",
    incomplete: "Incompleto",
    day_off: "Día libre",
  }[value];
}

export function parsePayrollReportRange(
  start: unknown,
  end: unknown,
): PayrollReportRange | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end) || start > end) return null;

  const startAt = dateAtBogotaMidnight(start);
  const endAt = dateAtBogotaMidnight(end);
  const endExclusive = dateAtBogotaMidnight(nextDate(end));
  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    Number.isNaN(endExclusive.getTime()) ||
    reportDay(startAt) !== start ||
    reportDay(endAt) !== end
  ) return null;
  return { startDate: start, endDate: end, startAt, endExclusive };
}

function firstDailyPair(events: Array<typeof attendanceEventsTable.$inferSelect>) {
  const checkIn = events.find((event) => event.type === "check_in") ?? null;
  const checkOut = checkIn
    ? events.find(
      (event) =>
        event.type === "check_out" &&
        event.occurredAt.getTime() > checkIn.occurredAt.getTime(),
    ) ?? null
    : null;
  return { checkIn, checkOut };
}

function timingIsOutside(value: AttendanceTimingStatus | null): boolean {
  return value === "outside_shift" || value === "day_off";
}

export async function buildPayrollAttendanceReport(
  range: PayrollReportRange,
): Promise<PayrollAttendanceReport> {
  const [employees, events] = await Promise.all([
    db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.active, true))
      .orderBy(asc(employeesTable.displayName)),
    db
      .select()
      .from(attendanceEventsTable)
      .where(
        and(
          gte(attendanceEventsTable.occurredAt, range.startAt),
          lt(attendanceEventsTable.occurredAt, range.endExclusive),
        ),
      )
      .orderBy(asc(attendanceEventsTable.employeeId), asc(attendanceEventsTable.occurredAt)),
  ]);
  const dates = reportDates(range.startDate, range.endDate);
  const eventsByEmployeeAndDay = new Map<string, Map<string, typeof events>>();
  for (const event of events) {
    const date = reportDay(event.occurredAt);
    const perEmployee = eventsByEmployeeAndDay.get(event.employeeId) ?? new Map();
    const current = perEmployee.get(date) ?? [];
    current.push(event);
    perEmployee.set(date, current);
    eventsByEmployeeAndDay.set(event.employeeId, perEmployee);
  }

  const reportEmployees = await Promise.all(employees.map(async (employee) => {
    const schedule = await getWeeklySchedule(employee.id);
    return buildEmployeeReport(employee, schedule.days, dates, eventsByEmployeeAndDay.get(employee.id));
  }));

  return {
    version: "1.0",
    timezone: TIME_ZONE,
    startDate: range.startDate,
    endDate: range.endDate,
    generatedAt: new Date(),
    employees: reportEmployees,
    totals: reportEmployees.reduce(
      (totals, employee) => ({
        employeeCount: totals.employeeCount + 1,
        expectedDays: totals.expectedDays + employee.expectedDays,
        absenceDays: totals.absenceDays + employee.absenceDays,
        incompleteDays: totals.incompleteDays + employee.incompleteDays,
        workedMinutes: totals.workedMinutes + employee.workedMinutes,
        lateEntries: totals.lateEntries + employee.lateEntries,
        outsideShiftEvents: totals.outsideShiftEvents + employee.outsideShiftEvents,
      }),
      {
        employeeCount: 0,
        expectedDays: 0,
        absenceDays: 0,
        incompleteDays: 0,
        workedMinutes: 0,
        lateEntries: 0,
        outsideShiftEvents: 0,
      },
    ),
  };
}

function buildEmployeeReport(
  employee: Employee,
  scheduleDays: Awaited<ReturnType<typeof getWeeklySchedule>>["days"],
  dates: string[],
  eventsByDay: Map<string, Array<typeof attendanceEventsTable.$inferSelect>> | undefined,
): PayrollReportEmployee {
  const days = dates.map((date) => {
    const scheduleDay = scheduleDayForDate(scheduleDays, dateAtBogotaMidnight(date));
    const scheduled = Boolean(scheduleDay?.startTime && scheduleDay.endTime);
    const { checkIn, checkOut } = firstDailyPair(eventsByDay?.get(date) ?? []);
    const checkInTiming = checkIn
      ? attendanceTimingStatus("check_in", checkIn.occurredAt, scheduleDay)
      : null;
    const checkOutTiming = checkOut
      ? attendanceTimingStatus("check_out", checkOut.occurredAt, scheduleDay)
      : null;
    const workedMinutes = checkIn && checkOut
      ? Math.max(0, Math.floor((checkOut.occurredAt.getTime() - checkIn.occurredAt.getTime()) / 60_000))
      : 0;

    return {
      date,
      scheduledStart: scheduleDay?.startTime ?? null,
      scheduledEnd: scheduleDay?.endTime ?? null,
      checkIn: checkIn?.occurredAt ?? null,
      checkOut: checkOut?.occurredAt ?? null,
      workedMinutes,
      state: checkIn
        ? checkOut ? "worked" : "incomplete"
        : scheduled ? "absent" : "day_off",
      checkInTiming,
      checkOutTiming,
    } satisfies PayrollReportDay;
  });

  return {
    id: employee.id,
    displayName: employee.displayName,
    documentNumber: employee.documentNumber,
    jobTitle: employee.jobTitle,
    expectedDays: days.filter((day) => day.scheduledStart && day.scheduledEnd).length,
    absenceDays: days.filter((day) => day.state === "absent").length,
    incompleteDays: days.filter((day) => day.state === "incomplete").length,
    workedMinutes: days.reduce((total, day) => total + day.workedMinutes, 0),
    lateEntries: days.filter((day) => day.checkInTiming === "late").length,
    outsideShiftEvents: days.filter(
      (day) => timingIsOutside(day.checkInTiming) || timingIsOutside(day.checkOutTiming),
    ).length,
    days,
  };
}

function xml(value: string | number | null): string {
  if (value === null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlAttribute(name: string, value: string | number | null): string {
  return value === null || value === "" ? "" : ` ${name}="${xml(value)}"`;
}

export function payrollReportXml(report: PayrollAttendanceReport): string {
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<farcheckPayrollReport version="${report.version}" timezone="${report.timezone}" generatedAt="${report.generatedAt.toISOString()}">`,
    `  <period startDate="${report.startDate}" endDate="${report.endDate}"/>`,
    `  <totals employeeCount="${report.totals.employeeCount}" expectedDays="${report.totals.expectedDays}" absenceDays="${report.totals.absenceDays}" incompleteDays="${report.totals.incompleteDays}" workedMinutes="${report.totals.workedMinutes}" lateEntries="${report.totals.lateEntries}" outsideShiftEvents="${report.totals.outsideShiftEvents}"/>`,
    "  <employees>",
  ];
  for (const employee of report.employees) {
    lines.push(
      `    <employee id="${xml(employee.id)}" displayName="${xml(employee.displayName)}"${xmlAttribute("documentNumber", employee.documentNumber)}${xmlAttribute("jobTitle", employee.jobTitle)}>`,
      `      <summary expectedDays="${employee.expectedDays}" absenceDays="${employee.absenceDays}" incompleteDays="${employee.incompleteDays}" workedMinutes="${employee.workedMinutes}" lateEntries="${employee.lateEntries}" outsideShiftEvents="${employee.outsideShiftEvents}"/>`,
      "      <days>",
    );
    for (const day of employee.days) {
      lines.push(
        `        <day date="${day.date}" state="${day.state}"${xmlAttribute("scheduledStart", day.scheduledStart)}${xmlAttribute("scheduledEnd", day.scheduledEnd)}${xmlAttribute("checkIn", day.checkIn?.toISOString() ?? null)}${xmlAttribute("checkOut", day.checkOut?.toISOString() ?? null)} workedMinutes="${day.workedMinutes}"${xmlAttribute("checkInTiming", day.checkInTiming)}${xmlAttribute("checkOutTiming", day.checkOutTiming)}/>`,
      );
    }
    lines.push("      </days>", "    </employee>");
  }
  lines.push("  </employees>", "</farcheckPayrollReport>", "");
  return lines.join("\n");
}

function pdfText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .slice(0, 104);
}

function makePdf(lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 47) {
    pages.push(lines.slice(index, index + 47));
  }
  if (pages.length === 0) pages.push(["Sin datos para el período seleccionado."]);

  const objects: string[] = [];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let nextId = 4;
  for (const page of pages) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  pages.forEach((page, index) => {
    const content = `BT\n/F1 8 Tf\n46 755 Td\n${page.map((line, lineIndex) => (
      `${lineIndex ? "0 -15 Td\n" : ""}(${pdfText(line)}) Tj`
    )).join("\n")}\nET`;
    const pageId = pageIds[index]!;
    const contentId = contentIds[index]!;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, "ascii");
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

export function payrollReportPdf(report: PayrollAttendanceReport): Buffer {
  const lines = [
    "FarCheck RD - Reporte de asistencia para nomina",
    `Periodo: ${report.startDate} al ${report.endDate}`,
    `Generado: ${report.generatedAt.toLocaleString("es-DO", { timeZone: TIME_ZONE })}`,
    "",
    "RESUMEN GENERAL",
    `Empleados: ${report.totals.employeeCount} | Jornadas esperadas: ${report.totals.expectedDays} | Ausencias: ${report.totals.absenceDays}`,
    `Horas registradas: ${duration(report.totals.workedMinutes)} | Jornadas incompletas: ${report.totals.incompleteDays}`,
    `Entradas tardias: ${report.totals.lateEntries} | Eventos fuera de jornada: ${report.totals.outsideShiftEvents}`,
    "",
  ];
  for (const employee of report.employees) {
    lines.push(
      `EMPLEADO: ${employee.displayName}${employee.documentNumber ? ` | Documento: ${employee.documentNumber}` : ""}`,
      `${employee.jobTitle ? `Cargo: ${employee.jobTitle} | ` : ""}Esperadas: ${employee.expectedDays} | Ausencias: ${employee.absenceDays} | Horas: ${duration(employee.workedMinutes)} | Incompletas: ${employee.incompleteDays}`,
      "Fecha       Programado   Entrada  Salida   Horas    Estado       Excepciones",
    );
    for (const day of employee.days) {
      const timing = [timingLabel(day.checkInTiming), timingLabel(day.checkOutTiming)]
        .filter(Boolean)
        .join(" / ");
      lines.push(
        `${day.date}  ${day.scheduledStart && day.scheduledEnd ? `${day.scheduledStart}-${day.scheduledEnd}` : "Libre      "}  ${timeAtBogota(day.checkIn).padEnd(7)}  ${timeAtBogota(day.checkOut).padEnd(7)}  ${duration(day.workedMinutes).padEnd(7)}  ${dayStateLabel(day.state).padEnd(11)} ${timing || "—"}`,
      );
    }
    lines.push("");
  }
  return makePdf(lines);
}