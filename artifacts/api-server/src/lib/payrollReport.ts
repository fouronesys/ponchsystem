import {
  attendanceEventsTable,
  db,
  employeesTable,
  type Employee,
} from "@workspace/db";
import { and, asc, gte, isNull, lte, lt, or } from "drizzle-orm";
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
  department: string | null;
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
      .where(
        and(
          lte(employeesTable.employmentStartDate, range.endDate),
          or(
            isNull(employeesTable.employmentEndDate),
            gte(employeesTable.employmentEndDate, range.startDate),
          ),
        ),
      )
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
    const employedOnDate =
      date >= employee.employmentStartDate &&
      (!employee.employmentEndDate || date <= employee.employmentEndDate);
    const scheduleDay = employedOnDate
      ? scheduleDayForDate(scheduleDays, dateAtBogotaMidnight(date))
      : undefined;
    const scheduled = Boolean(scheduleDay?.startTime && scheduleDay.endTime);
    const { checkIn, checkOut } = employedOnDate
      ? firstDailyPair(eventsByDay?.get(date) ?? [])
      : { checkIn: null, checkOut: null };
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
    department: employee.department,
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
      `    <employee id="${xml(employee.id)}" displayName="${xml(employee.displayName)}"${xmlAttribute("documentNumber", employee.documentNumber)}${xmlAttribute("jobTitle", employee.jobTitle)}${xmlAttribute("department", employee.department)}>`,
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
    .slice(0, 104)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

type PdfColor = [number, number, number];
const NAVY: PdfColor = [0.06, 0.16, 0.26];
const BLUE: PdfColor = [0.09, 0.49, 0.86];
const PALE_BLUE: PdfColor = [0.91, 0.96, 1];
const SLATE: PdfColor = [0.29, 0.36, 0.44];
const MUTED: PdfColor = [0.42, 0.48, 0.55];
const GREEN: PdfColor = [0.06, 0.55, 0.38];
const AMBER: PdfColor = [0.86, 0.48, 0.03];
const RED: PdfColor = [0.78, 0.16, 0.16];

function color(value: PdfColor): string {
  return `${value[0]} ${value[1]} ${value[2]}`;
}

function pdfRect(x: number, y: number, width: number, height: number, fill: PdfColor): string {
  return `${color(fill)} rg ${x} ${y} ${width} ${height} re f\n`;
}

function pdfCircle(x: number, y: number, radius: number, fill: PdfColor): string {
  const k = radius * 0.5522848;
  return [
    `${color(fill)} rg`,
    `${x + radius} ${y} m`,
    `${x + radius} ${y + k} ${x + k} ${y + radius} ${x} ${y + radius} c`,
    `${x - k} ${y + radius} ${x - radius} ${y + k} ${x - radius} ${y} c`,
    `${x - radius} ${y - k} ${x - k} ${y - radius} ${x} ${y - radius} c`,
    `${x + k} ${y - radius} ${x + radius} ${y - k} ${x + radius} ${y} c`,
    "f\n",
  ].join(" ");
}

function pdfStrokePath(path: string, stroke: PdfColor, width: number): string {
  return `${color(stroke)} RG ${width} w ${path} S\n`;
}

function pdfLine(x: number, y: number, width: number, stroke: PdfColor): string {
  return `${color(stroke)} RG 0.6 w ${x} ${y} m ${x + width} ${y} l S\n`;
}

function pdfLabel(
  x: number,
  y: number,
  value: string,
  size: number,
  font: "F1" | "F2" = "F1",
  fill: PdfColor = SLATE,
): string {
  return `${color(fill)} rg BT /${font} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET\n`;
}

function farbotLogo(x: number, y: number): string {
  return [
    pdfRect(x, y, 40, 40, BLUE),
    pdfStrokePath(` ${x + 20} ${y + 34} m ${x + 20} ${y + 29} l`, [0.96, 0.73, 0.26], 2.2),
    pdfStrokePath(` ${x + 15} ${y + 34} m ${x + 25} ${y + 34} l`, [0.96, 0.73, 0.26], 2.2),
    pdfCircle(x + 20, y + 37, 2.8, [0.96, 0.73, 0.26]),
    pdfRect(x + 8, y + 12, 24, 19, [0.20, 0.45, 0.58]),
    pdfRect(x + 10, y + 17, 20, 11, [0.87, 0.97, 1]),
    pdfCircle(x + 15, y + 22.5, 2.6, NAVY),
    pdfCircle(x + 25, y + 22.5, 2.6, NAVY),
    pdfCircle(x + 15.8, y + 23.3, 0.8, [1, 1, 1]),
    pdfCircle(x + 25.8, y + 23.3, 0.8, [1, 1, 1]),
    pdfStrokePath(` ${x + 15} ${y + 15.5} m ${x + 18} ${y + 14} l ${x + 22} ${y + 14} l ${x + 25} ${y + 15.5}`, [0.18, 0.40, 0.52], 1.3),
    pdfRect(x + 14, y + 8, 12, 5, [0.96, 0.73, 0.26]),
    pdfStrokePath(` ${x + 16.5} ${y + 10.5} m ${x + 18.5} ${y + 8.8} l ${x + 23.5} ${y + 12.2}`, NAVY, 1.4),
  ].join("");
}

function pageHeader(pageNumber: number, pageCount: number): string {
  return [
    pdfRect(0, 732, 612, 60, NAVY),
    farbotLogo(40, 742),
    pdfLabel(94, 766, "FarCheck RD", 15, "F2", [1, 1, 1]),
    pdfLabel(94, 750, "Control de asistencia", 8, "F1", [0.78, 0.87, 0.95]),
    pdfLabel(500, 759, `${pageNumber} / ${pageCount}`, 8, "F1", [0.78, 0.87, 0.95]),
  ].join("");
}

function statusColor(state: PayrollReportDay["state"]): PdfColor {
  return state === "worked" ? GREEN : state === "absent" ? RED : state === "incomplete" ? AMBER : MUTED;
}

function makePdf(pages: string[]): Buffer {
  if (pages.length === 0) pages.push(pageHeader(1, 1));
  const objects: string[] = [];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let nextId = 5;
  for (const _page of pages) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((page, index) => {
    const designedContent = page;
    const pageId = pageIds[index]!;
    const contentId = contentIds[index]!;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(designedContent, "ascii")} >>\nstream\n${designedContent}\nendstream`;
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
  const employeePages = report.employees.flatMap((employee) => {
    const chunks: PayrollReportDay[][] = [];
    for (let index = 0; index < employee.days.length; index += 25) {
      chunks.push(employee.days.slice(index, index + 25));
    }
    return chunks.length ? chunks.map((days) => ({ employee, days })) : [{ employee, days: [] }];
  });
  const pageCount = Math.max(1, employeePages.length + 1);
  const pages: string[] = [];

  let summary = pageHeader(1, pageCount);
  summary += pdfLabel(46, 710, "Reporte de asistencia", 22, "F2", NAVY);
  summary += pdfLabel(46, 688, "Resumen claro para revisión y preparación de nómina", 10, "F1", MUTED);
  summary += pdfLabel(46, 665, `Período: ${report.startDate} al ${report.endDate}`, 10, "F2", SLATE);
  summary += pdfLabel(430, 665, `Generado: ${report.generatedAt.toLocaleDateString("es-DO", { timeZone: TIME_ZONE })}`, 8, "F1", MUTED);

  const cards = [
    ["Empleados", String(report.totals.employeeCount), BLUE],
    ["Jornadas esperadas", String(report.totals.expectedDays), NAVY],
    ["Ausencias", String(report.totals.absenceDays), RED],
    ["Horas registradas", duration(report.totals.workedMinutes), GREEN],
  ] as const;
  cards.forEach(([label, value, fill], index) => {
    const x = 46 + index * 130;
    summary += pdfRect(x, 590, 118, 54, PALE_BLUE);
    summary += pdfRect(x, 590, 5, 54, fill);
    summary += pdfLabel(x + 14, 625, label, 8, "F1", MUTED);
    summary += pdfLabel(x + 14, 603, value, 16, "F2", fill);
  });
  summary += pdfLabel(46, 555, "Indicadores de atención", 12, "F2", NAVY);
  summary += pdfLine(46, 546, 520, PALE_BLUE);
  summary += pdfLabel(52, 522, `Entradas tardías: ${report.totals.lateEntries}`, 10, "F2", AMBER);
  summary += pdfLabel(220, 522, `Eventos fuera de jornada: ${report.totals.outsideShiftEvents}`, 10, "F2", RED);
  summary += pdfLabel(450, 522, `Incompletas: ${report.totals.incompleteDays}`, 10, "F2", SLATE);
  summary += pdfLabel(46, 480, "Resumen por empleado", 12, "F2", NAVY);
  summary += pdfRect(46, 450, 520, 22, NAVY);
  summary += pdfLabel(56, 457, "Empleado / departamento", 8, "F2", [1, 1, 1]);
  summary += pdfLabel(286, 457, "Esperadas", 8, "F2", [1, 1, 1]);
  summary += pdfLabel(358, 457, "Ausencias", 8, "F2", [1, 1, 1]);
  summary += pdfLabel(430, 457, "Horas", 8, "F2", [1, 1, 1]);
  summary += pdfLabel(500, 457, "Alertas", 8, "F2", [1, 1, 1]);
  report.employees.slice(0, 16).forEach((employee, index) => {
    const y = 430 - index * 22;
    if (index % 2 === 0) summary += pdfRect(46, y - 6, 520, 22, [0.97, 0.98, 0.99]);
    const alerts = employee.lateEntries + employee.outsideShiftEvents + employee.incompleteDays;
    summary += pdfLabel(56, y + 5, employee.displayName, 8, "F1", SLATE);
    summary += pdfLabel(56, y - 5, employee.department ?? "Sin departamento", 7, "F1", MUTED);
    summary += pdfLabel(296, y, String(employee.expectedDays), 8, "F1", SLATE);
    summary += pdfLabel(368, y, String(employee.absenceDays), 8, "F1", employee.absenceDays ? RED : SLATE);
    summary += pdfLabel(430, y, duration(employee.workedMinutes), 8, "F1", SLATE);
    summary += pdfLabel(510, y, String(alerts), 8, "F2", alerts ? AMBER : GREEN);
  });
  if (report.employees.length > 16) {
    summary += pdfLabel(46, 72, `Consulta el detalle diario de los ${report.employees.length} empleados en las páginas siguientes.`, 8, "F1", MUTED);
  }
  summary += pdfLine(46, 54, 520, PALE_BLUE);
  summary += pdfLabel(46, 38, "Farbot · Reporte generado por FarCheck RD", 7, "F1", MUTED);
  pages.push(summary);

  employeePages.forEach(({ employee, days }, employeePageIndex) => {
    const pageNumber = employeePageIndex + 2;
    let page = pageHeader(pageNumber, pageCount);
    page += pdfLabel(46, 710, employee.displayName, 18, "F2", NAVY);
    page += pdfLabel(46, 690, `${employee.department ? `${employee.department} · ` : ""}${employee.jobTitle ? `${employee.jobTitle} · ` : ""}${employee.documentNumber ? `Documento: ${employee.documentNumber}` : "Sin documento"}`, 9, "F1", MUTED);
    page += pdfLabel(420, 700, `Horas: ${duration(employee.workedMinutes)}`, 9, "F2", GREEN);
    page += pdfLabel(420, 685, `Ausencias: ${employee.absenceDays}`, 9, "F2", employee.absenceDays ? RED : SLATE);
    page += pdfRect(46, 650, 520, 24, NAVY);
    page += pdfLabel(54, 658, "Fecha", 8, "F2", [1, 1, 1]);
    page += pdfLabel(118, 658, "Jornada", 8, "F2", [1, 1, 1]);
    page += pdfLabel(218, 658, "Entrada", 8, "F2", [1, 1, 1]);
    page += pdfLabel(282, 658, "Salida", 8, "F2", [1, 1, 1]);
    page += pdfLabel(348, 658, "Horas", 8, "F2", [1, 1, 1]);
    page += pdfLabel(400, 658, "Estado", 8, "F2", [1, 1, 1]);
    page += pdfLabel(476, 658, "Nota", 8, "F2", [1, 1, 1]);
    days.forEach((day, dayIndex) => {
      const y = 632 - dayIndex * 22;
      if (dayIndex % 2 === 0) page += pdfRect(46, y - 6, 520, 22, [0.97, 0.98, 0.99]);
      const schedule = day.scheduledStart && day.scheduledEnd ? `${day.scheduledStart}-${day.scheduledEnd}` : "Libre";
      const timing = timingLabel(day.checkInTiming) ?? timingLabel(day.checkOutTiming) ?? "—";
      page += pdfLabel(54, y, day.date, 8, "F1", SLATE);
      page += pdfLabel(118, y, schedule, 8, "F1", SLATE);
      page += pdfLabel(218, y, timeAtBogota(day.checkIn), 8, "F1", SLATE);
      page += pdfLabel(282, y, timeAtBogota(day.checkOut), 8, "F1", SLATE);
      page += pdfLabel(348, y, duration(day.workedMinutes), 8, "F1", SLATE);
      page += pdfLabel(400, y, dayStateLabel(day.state), 8, "F2", statusColor(day.state));
      page += pdfLabel(476, y, timing, 8, "F1", timing === "A tiempo" ? GREEN : timing === "—" ? MUTED : AMBER);
    });
    page += pdfLine(46, 65, 520, PALE_BLUE);
    page += pdfLabel(46, 48, "FarCheck RD · Documento informativo para revisión de asistencia; no calcula salarios ni deducciones.", 7, "F1", MUTED);
    pages.push(page);
  });
  return makePdf(pages);
}