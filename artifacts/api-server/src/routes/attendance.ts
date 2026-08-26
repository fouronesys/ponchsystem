import {
  CreateQrDisplayLinkResponse,
  GetQrDisplayStatusParams,
  GetQrDisplayStatusResponse,
  GetAttendanceSummaryResponse,
  GetQrStatusResponse,
  GetTodayAttendanceResponse,
  ListAttendanceEventsQueryParams,
  ListAttendanceEventsResponse,
  RecordManualAttendanceBody,
  RotateQrTokenResponse,
  ScanAttendanceQrBody,
  ScanAttendanceQrResponse,
} from "@workspace/api-zod";
import {
  attendanceEventsTable,
  attendanceTokensTable,
  cleanupExpiredQrRecords,
  db,
  employeesTable,
  qrDisplayLinksTable,
  type AttendanceToken,
  type Employee,
} from "@workspace/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  type AuthenticatedRequest,
  requireAdministrator,
  requireAuthenticated,
} from "../middlewares/attendanceAuth";
import {
  canAttemptScan,
  clearScanAttempts,
  createDisplayAccessToken,
  createRotatingToken,
  decryptToken,
  displayLinkExpiry,
  encryptToken,
  hashDisplayAccessToken,
  hashToken,
  secondsUntil,
  tokenExpiry,
} from "../lib/qrSecurity";
import { removeImage, saveImage } from "../lib/imageStorage";
import { logger } from "../lib/logger";
import {
  AttendanceLocationError,
  serializeLocationEvidence,
  validateAttendanceLocation,
  type ValidatedAttendanceLocation,
} from "../lib/attendanceLocation";
import {
  buildPayrollAttendanceReport,
  parsePayrollReportRange,
  payrollReportPdf,
  payrollReportXml,
} from "../lib/payrollReport";
import {
  attendanceTimingStatus,
  getWeeklySchedule,
  scheduleDayForDate,
  type AttendanceTimingStatus,
} from "../lib/weeklySchedule";

const router: IRouter = Router();
const QR_CLEANUP_INTERVAL_MS = 60_000;

const qrCleanupTimer = setInterval(() => {
  try {
    const removed = cleanupExpiredQrRecords();
    if (removed.attendanceTokens > 0 || removed.displayLinks > 0) {
      logger.info(removed, "Expired QR records cleaned up");
    }
  } catch (error) {
    logger.warn({ err: error }, "Expired QR record cleanup failed");
  }
}, QR_CLEANUP_INTERVAL_MS);
qrCleanupTimer.unref();

function setQrDisplayNoCacheHeaders(res: Response): void {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

function bogotaDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const piece = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${piece("year")}-${piece("month")}-${piece("day")}`;
}

export function hasPreviousOpenAttendance(
  events: ReadonlyArray<{ type: "check_in" | "check_out"; occurredAt: Date }>,
  now: Date,
): boolean {
  const latest = events[0];
  if (!latest || latest.type !== "check_in") return false;
  const age = now.getTime() - latest.occurredAt.getTime();
  return age >= 0 && age <= 18 * 60 * 60 * 1000;
}

function eventResponse(
  event: typeof attendanceEventsTable.$inferSelect,
  employee: Employee,
  scheduleDays: Array<{ dayOfWeek: number; startTime: string | null; endTime: string | null }> = [],
) {
  const scheduleDay = scheduleDayForDate(scheduleDays, event.occurredAt);
  const timingStatus: AttendanceTimingStatus = attendanceTimingStatus(event.type as "check_in" | "check_out", event.occurredAt, scheduleDay);
  return {
    id: event.id,
    employeeId: event.employeeId,
    employeeName: employee.displayName,
    type: event.type as "check_in" | "check_out",
    timestamp: event.occurredAt,
    location: event.location,
    deviceLabel: event.deviceLabel,
    selfieUrl: event.selfiePath ? `/api/media/${event.selfiePath}` : null,
    loginAt: event.loginAt,
    timingStatus,
    scheduledTime: scheduleDay
      ? event.type === "check_in" ? scheduleDay.startTime : scheduleDay.endTime
      : null,
  };
}

function tokenStatus(token: AttendanceToken, rawToken: string) {
  return {
    token: rawToken,
    expiresAt: token.expiresAt,
    rotatedAt: token.createdAt,
    remainingSeconds: secondsUntil(token.expiresAt),
  };
}

function newTokenValues(tokenType: "qr" | "manual" = "qr") {
  const rawToken = createRotatingToken();
  return {
    rawToken,
    values: {
      id: randomUUID(),
      tokenHash: hashToken(rawToken),
      encryptedToken: encryptToken(rawToken),
      tokenType,
      expiresAt: tokenExpiry(),
      isActive: true,
    },
  };
}

async function issueNewToken(): Promise<{ token: AttendanceToken; rawToken: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = newTokenValues();
    try {
      const token = db.transaction((tx) => {
        tx
          .update(attendanceTokensTable)
          .set({ isActive: false })
          .where(and(eq(attendanceTokensTable.isActive, true), eq(attendanceTokensTable.tokenType, "qr")))
          .run();
        const created = tx
          .insert(attendanceTokensTable)
          .values(next.values)
          .returning()
          .get();
        if (!created) {
          throw new Error("Unable to create rotating QR token");
        }
        return created;
      });
      return { token, rawToken: next.rawToken };
    } catch {
      const [active] = await db
        .select()
        .from(attendanceTokensTable)
        .where(
          and(
            eq(attendanceTokensTable.isActive, true),
            eq(attendanceTokensTable.tokenType, "qr"),
            gt(attendanceTokensTable.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(attendanceTokensTable.createdAt))
        .limit(1);
      if (active) {
        return { token: active, rawToken: decryptToken(active.encryptedToken) };
      }
    }
  }

  throw new Error("Unable to issue rotating QR token");
}

function issueManualToken(): string {
  const next = newTokenValues("manual");
  db.transaction((tx) => {
    tx.insert(attendanceTokensTable).values(next.values).run();
  });
  return next.rawToken;
}

async function currentToken(): Promise<{ token: AttendanceToken; rawToken: string }> {
  const [active] = await db
    .select()
    .from(attendanceTokensTable)
    .where(
      and(
        eq(attendanceTokensTable.isActive, true),
        eq(attendanceTokensTable.tokenType, "qr"),
        gt(attendanceTokensTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(attendanceTokensTable.createdAt))
    .limit(1);

  if (active) {
    return { token: active, rawToken: decryptToken(active.encryptedToken) };
  }
  return issueNewToken();
}

async function employeeEvents(employeeId: string) {
  return db
    .select()
    .from(attendanceEventsTable)
    .where(eq(attendanceEventsTable.employeeId, employeeId))
    .orderBy(desc(attendanceEventsTable.occurredAt))
    .limit(50);
}

router.get(
  "/attendance/today",
  requireAuthenticated,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const employee = req.employee!;
    const events = await employeeEvents(employee.id);
    const today = bogotaDay(new Date());
    const todayEvents = events.filter((event) => bogotaDay(event.occurredAt) === today);
    const latest = todayEvents[0];
    const checkIn = todayEvents.find((event) => event.type === "check_in");
    const checkOut = todayEvents.find((event) => event.type === "check_out");
    const schedule = await getWeeklySchedule(employee.id);
    const checkInTimingStatus = checkIn
      ? attendanceTimingStatus("check_in", checkIn.occurredAt, scheduleDayForDate(schedule.days, checkIn.occurredAt))
      : null;
    const checkOutTimingStatus = checkOut
      ? attendanceTimingStatus("check_out", checkOut.occurredAt, scheduleDayForDate(schedule.days, checkOut.occurredAt))
      : null;
    const endedAt = checkOut?.occurredAt ?? new Date();
    const workedMinutes = checkIn
      ? Math.max(0, Math.floor((endedAt.getTime() - checkIn.occurredAt.getTime()) / 60_000))
      : 0;

    res.json(
      GetTodayAttendanceResponse.parse({
        employeeId: employee.id,
        employeeName: employee.displayName,
        state: !latest
          ? "out"
          : latest.type === "check_in"
            ? "checked_in"
            : "checked_out",
        checkIn: checkIn?.occurredAt ?? null,
        checkOut: checkOut?.occurredAt ?? null,
        workedMinutes,
          checkInTimingStatus,
          checkOutTimingStatus,
      }),
    );
  },
);

async function recordAttendanceWithToken(
  req: AuthenticatedRequest,
  rawToken: string,
  selfie: string,
  tokenType: "qr" | "manual",
  location: ValidatedAttendanceLocation,
) {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const employee = req.employee!;
    const scanKey = `${tokenType}:${employee.id}:${clientIp}`;

    let selfiePath: string;
    try {
      selfiePath = await saveImage(selfie, "selfies");
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "La selfie es obligatoria.");
    }

    const now = new Date();
    const tokenHash = hashToken(rawToken);
    try {
      const schedule = await getWeeklySchedule(employee.id);
      const event = db.transaction((tx) => {
        const consumed = tx
          .update(attendanceTokensTable)
          .set({ usedAt: now, isActive: false })
          .where(
            and(
              eq(attendanceTokensTable.tokenHash, tokenHash),
              eq(attendanceTokensTable.tokenType, tokenType),
              eq(attendanceTokensTable.isActive, true),
              isNull(attendanceTokensTable.usedAt),
              gt(attendanceTokensTable.expiresAt, now),
            ),
          )
          .returning()
          .get();

        if (!consumed) return null;

        const events = tx
          .select()
          .from(attendanceEventsTable)
          .where(eq(attendanceEventsTable.employeeId, employee.id))
          .orderBy(desc(attendanceEventsTable.occurredAt))
          .limit(50)
          .all();
        const today = bogotaDay(now);
        const todayLatest = events.find((item) => bogotaDay(item.occurredAt) === today);
        if (
          tokenType === "manual" &&
          events[0] &&
          events[0].recordMethod === "manual" &&
          now.getTime() - events[0].occurredAt.getTime() < 10_000
        ) {
          return null;
        }
        const previousOpenEvent = !todayLatest &&
          hasPreviousOpenAttendance(events, now) &&
          scheduleDayForDate(schedule.days, events[0]!.occurredAt)?.endTime !== null;
        const created = tx
          .insert(attendanceEventsTable)
          .values({
            id: randomUUID(),
            employeeId: employee.id,
            type: todayLatest?.type === "check_in" || previousOpenEvent ? "check_out" : "check_in",
            recordMethod: tokenType,
            occurredAt: now,
            location: serializeLocationEvidence(location),
            deviceLabel: req.get("user-agent")?.slice(0, 180) ?? null,
            sessionId: req.session?.id ?? null,
            loginAt: req.session?.loginAt ?? null,
            selfiePath,
          })
          .returning()
          .get();
        if (!created) throw new Error("Unable to create attendance event");

        if (tokenType === "qr") {
          tx.insert(attendanceTokensTable).values(newTokenValues("qr").values).run();
        }
        return created;
      });

      if (!event) {
        await removeImage(selfiePath);
        return null;
      }

      clearScanAttempts(scanKey);
      return { event, schedule };
    } catch (error) {
      await removeImage(selfiePath);
      throw error;
    }
}

router.post(
  "/attendance/scan",
  requireAuthenticated,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const parsed = ScanAttendanceQrBody.safeParse(req.body);
    if (!parsed.success) {
      if (
        req.body &&
        typeof req.body === "object" &&
        typeof req.body.token === "string" &&
        typeof req.body.selfie === "string" &&
        req.body.token.length >= 16 &&
        req.body.selfie.length >= 100
      ) {
        if (!("location" in req.body) || req.body.location == null) {
          res.status(400).json({
            code: "LOCATION_REQUIRED",
            error: "Necesitamos tu ubicación para registrar la asistencia.",
          });
          return;
        }
        try {
          validateAttendanceLocation(req.body.location);
        } catch (error) {
          if (error instanceof AttendanceLocationError) {
            res.status(400).json({ code: error.code, error: error.message });
            return;
          }
          throw error;
        }
      }
      res.status(400).json({ error: "Código QR inválido" });
      return;
    }
    let location: ValidatedAttendanceLocation;
    try {
      location = validateAttendanceLocation(parsed.data.location);
    } catch (error) {
      if (error instanceof AttendanceLocationError) {
        res.status(400).json({ code: error.code, error: error.message });
        return;
      }
      throw error;
    }

    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const scanKey = `qr:${req.employee!.id}:${clientIp}`;
    if (!canAttemptScan(scanKey)) {
      req.log.warn({ employeeId: req.employee!.id }, "QR scan rate limit exceeded");
      res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
      return;
    }

    try {
      const result = await recordAttendanceWithToken(
        req,
        parsed.data.token,
        parsed.data.selfie,
        "qr",
        location,
      );
      if (!result) {
        req.log.warn({ employeeId: req.employee!.id }, "QR token rejected");
        res.status(400).json({ error: "El QR expiró, ya fue utilizado o no es válido." });
        return;
      }
      res.json(ScanAttendanceQrResponse.parse(eventResponse(result.event, req.employee!, result.schedule.days)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "No pudimos registrar la asistencia." });
    }
  },
);

router.post(
  "/attendance/manual",
  requireAuthenticated,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const selfieParsed = RecordManualAttendanceBody.shape.selfie.safeParse(
      req.body?.selfie,
    );
    if (!selfieParsed.success) {
      res.status(400).json({ error: "La selfie es obligatoria." });
      return;
    }
    let location: ValidatedAttendanceLocation;
    try {
      location = validateAttendanceLocation(req.body?.location);
    } catch (error) {
      if (error instanceof AttendanceLocationError) {
        res.status(400).json({ code: error.code, error: error.message });
        return;
      }
      throw error;
    }

    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const scanKey = `manual:${req.employee!.id}:${clientIp}`;
    if (!canAttemptScan(scanKey)) {
      req.log.warn({ employeeId: req.employee!.id }, "Manual attendance rate limit exceeded");
      res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
      return;
    }

    try {
      const manualToken = issueManualToken();
      const result = await recordAttendanceWithToken(
        req,
        manualToken,
        selfieParsed.data,
        "manual",
        location,
      );
      if (!result) {
        res.status(400).json({ error: "El registro manual expiró o ya fue utilizado." });
        return;
      }
      res.json(ScanAttendanceQrResponse.parse(eventResponse(result.event, req.employee!, result.schedule.days)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "No pudimos registrar la asistencia." });
    }
  },
);

router.get(
  "/admin/qr",
  requireAdministrator,
  async (_req, res): Promise<void> => {
    const qr = await currentToken();
    res.json(GetQrStatusResponse.parse(tokenStatus(qr.token, qr.rawToken)));
  },
);

router.post(
  "/admin/qr/rotate",
  requireAdministrator,
  async (_req, res): Promise<void> => {
    const qr = await issueNewToken();
    res.json(RotateQrTokenResponse.parse(tokenStatus(qr.token, qr.rawToken)));
  },
);

router.post(
  "/admin/qr/display-link",
  requireAdministrator,
  async (_req, res): Promise<void> => {
    const now = new Date();
    const accessToken = createDisplayAccessToken();
    const expiresAt = displayLinkExpiry();

    db.transaction((tx) => {
      tx
        .update(qrDisplayLinksTable)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(qrDisplayLinksTable.revokedAt),
            gt(qrDisplayLinksTable.expiresAt, now),
          ),
        )
        .run();
      tx
        .insert(qrDisplayLinksTable)
        .values({
          id: randomUUID(),
          accessHash: hashDisplayAccessToken(accessToken),
          expiresAt,
        })
        .run();
    });

    res.status(201).json(
      CreateQrDisplayLinkResponse.parse({ accessToken, expiresAt }),
    );
  },
);

router.delete(
  "/admin/qr/display-link",
  requireAdministrator,
  async (_req, res): Promise<void> => {
    const now = new Date();
    await db
      .update(qrDisplayLinksTable)
      .set({ revokedAt: now })
      .where(
        and(
          isNull(qrDisplayLinksTable.revokedAt),
          gt(qrDisplayLinksTable.expiresAt, now),
        ),
      );
    res.status(204).end();
  },
);

router.get(
  "/qr-display/:accessToken",
  async (req, res): Promise<void> => {
    setQrDisplayNoCacheHeaders(res);
    const parsed = GetQrDisplayStatusParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(404).json({ error: "Enlace de pantalla inválido, vencido o revocado." });
      return;
    }

    const now = new Date();
    const [displayLink] = await db
      .select({ id: qrDisplayLinksTable.id })
      .from(qrDisplayLinksTable)
      .where(
        and(
          eq(qrDisplayLinksTable.accessHash, hashDisplayAccessToken(parsed.data.accessToken)),
          gt(qrDisplayLinksTable.expiresAt, now),
          isNull(qrDisplayLinksTable.revokedAt),
        ),
      )
      .limit(1);
    if (!displayLink) {
      res.status(404).json({ error: "Enlace de pantalla inválido, vencido o revocado." });
      return;
    }

    const [latestScan] = await db
      .select({ id: attendanceEventsTable.id })
      .from(attendanceEventsTable)
      .orderBy(desc(attendanceEventsTable.occurredAt))
      .limit(1);
    const qr = await currentToken();
    res.json(
      GetQrDisplayStatusResponse.parse({
        token: qr.rawToken,
        expiresAt: qr.token.expiresAt,
        remainingSeconds: secondsUntil(qr.token.expiresAt),
        scanSequence: latestScan?.id ?? null,
      }),
    );
  },
);

router.get(
  "/admin/attendance",
  requireAdministrator,
  async (req, res): Promise<void> => {
    const requestedDate =
      typeof req.query.date === "string"
        ? new Date(`${req.query.date}T12:00:00-05:00`)
        : undefined;
    const parsed = ListAttendanceEventsQueryParams.safeParse({
      date: requestedDate,
    });
    if (!parsed.success || (requestedDate && Number.isNaN(requestedDate.getTime()))) {
      res.status(400).json({ error: "Fecha inválida" });
      return;
    }

    const rows = await db
      .select({
        event: attendanceEventsTable,
        employee: employeesTable,
      })
      .from(attendanceEventsTable)
      .innerJoin(
        employeesTable,
        eq(attendanceEventsTable.employeeId, employeesTable.id),
      )
      .orderBy(desc(attendanceEventsTable.occurredAt))
      .limit(100);
    const filterDay = parsed.data.date ? bogotaDay(parsed.data.date) : null;
    const schedules = new Map<string, Awaited<ReturnType<typeof getWeeklySchedule>>["days"]>();
    await Promise.all([...new Set(rows.map((row) => row.employee.id))].map(async (employeeId) => {
      schedules.set(employeeId, (await getWeeklySchedule(employeeId)).days);
    }));
    const events = rows
      .filter((row) => !filterDay || bogotaDay(row.event.occurredAt) === filterDay)
      .map((row) => eventResponse(row.event, row.employee, schedules.get(row.employee.id)));

    res.json(ListAttendanceEventsResponse.parse(events));
  },
);

router.get(
  "/admin/reports/attendance.pdf",
  requireAdministrator,
  async (req, res): Promise<void> => {
    const range = parsePayrollReportRange(req.query.start, req.query.end);
    if (!range) {
      res.status(400).json({ error: "Selecciona un rango de fechas válido." });
      return;
    }
    const report = await buildPayrollAttendanceReport(range);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="farcheck-rd-asistencia-${range.startDate}-${range.endDate}.pdf"`,
      "Cache-Control": "no-store, private",
    });
    res.send(payrollReportPdf(report));
  },
);

router.get(
  "/admin/reports/attendance.xml",
  requireAdministrator,
  async (req, res): Promise<void> => {
    const range = parsePayrollReportRange(req.query.start, req.query.end);
    if (!range) {
      res.status(400).json({ error: "Selecciona un rango de fechas válido." });
      return;
    }
    const report = await buildPayrollAttendanceReport(range);
    res.set({
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="farcheck-rd-asistencia-${range.startDate}-${range.endDate}.xml"`,
      "Cache-Control": "no-store, private",
    });
    res.send(payrollReportXml(report));
  },
);

router.get(
  "/admin/summary",
  requireAdministrator,
  async (_req, res): Promise<void> => {
    const today = bogotaDay(new Date());
    const [employees, rows] = await Promise.all([
      db.select().from(employeesTable).where(eq(employeesTable.active, true)),
      db
        .select({
          event: attendanceEventsTable,
          employee: employeesTable,
        })
        .from(attendanceEventsTable)
        .innerJoin(
          employeesTable,
          eq(attendanceEventsTable.employeeId, employeesTable.id),
        )
        .orderBy(desc(attendanceEventsTable.occurredAt))
        .limit(500),
    ]);
    const todayRows = rows.filter((row) => bogotaDay(row.event.occurredAt) === today);
    const latestByEmployee = new Map<string, (typeof todayRows)[number]>();
    for (const row of todayRows) {
      if (!latestByEmployee.has(row.event.employeeId)) {
        latestByEmployee.set(row.event.employeeId, row);
      }
    }
    const present = [...latestByEmployee.values()].filter(
      (row) => row.event.type === "check_in",
    );
     const schedules = new Map<string, Awaited<ReturnType<typeof getWeeklySchedule>>["days"]>();
     await Promise.all([...new Set(todayRows.map((row) => row.employee.id))].map(async (employeeId) => {
       schedules.set(employeeId, (await getWeeklySchedule(employeeId)).days);
     }));
     const late = todayRows.filter((row) =>
       row.event.type === "check_in" &&
       attendanceTimingStatus("check_in", row.event.occurredAt, scheduleDayForDate(schedules.get(row.employee.id) ?? [], row.event.occurredAt)) === "late"
     );
    const last = todayRows[0];

    res.json(
      GetAttendanceSummaryResponse.parse({
        present: present.length,
        expected: employees.length,
        late: late.length,
        checkedOut: [...latestByEmployee.values()].filter(
          (row) => row.event.type === "check_out",
        ).length,
         lastEvent: last ? eventResponse(last.event, last.employee, schedules.get(last.employee.id)) : null,
      }),
    );
  },
);

export default router;