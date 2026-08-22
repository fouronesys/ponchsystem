import {
  GetAttendanceSummaryResponse,
  GetQrStatusResponse,
  GetTodayAttendanceResponse,
  ListAttendanceEventsQueryParams,
  ListAttendanceEventsResponse,
  RotateQrTokenResponse,
  ScanAttendanceQrBody,
  ScanAttendanceQrResponse,
} from "@workspace/api-zod";
import {
  attendanceEventsTable,
  attendanceTokensTable,
  db,
  employeesTable,
  type AttendanceToken,
  type Employee,
} from "@workspace/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  type AuthenticatedRequest,
  requireAdministrator,
  requireAuthenticated,
} from "../middlewares/attendanceAuth";
import {
  canAttemptScan,
  clearScanAttempts,
  createRotatingToken,
  decryptToken,
  encryptToken,
  hashToken,
  secondsUntil,
  tokenExpiry,
} from "../lib/qrSecurity";

const router: IRouter = Router();

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

function eventResponse(
  event: typeof attendanceEventsTable.$inferSelect,
  employee: Employee,
) {
  return {
    id: event.id,
    employeeId: event.employeeId,
    employeeName: employee.displayName,
    type: event.type as "check_in" | "check_out",
    timestamp: event.occurredAt,
    location: event.location,
    deviceLabel: event.deviceLabel,
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

function newTokenValues() {
  const rawToken = createRotatingToken();
  return {
    rawToken,
    values: {
      id: randomUUID(),
      tokenHash: hashToken(rawToken),
      encryptedToken: encryptToken(rawToken),
      expiresAt: tokenExpiry(),
      isActive: true,
    },
  };
}

async function issueNewToken(): Promise<{ token: AttendanceToken; rawToken: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = newTokenValues();
    try {
      const token = await db.transaction(async (tx) => {
        await tx
          .update(attendanceTokensTable)
          .set({ isActive: false })
          .where(eq(attendanceTokensTable.isActive, true));
        const [created] = await tx
          .insert(attendanceTokensTable)
          .values(next.values)
          .returning();
        return created;
      });
      return { token, rawToken: next.rawToken };
    } catch {
      const [active] = await db
        .select()
        .from(attendanceTokensTable)
        .where(eq(attendanceTokensTable.isActive, true))
        .orderBy(desc(attendanceTokensTable.createdAt))
        .limit(1);
      if (active) {
        return { token: active, rawToken: decryptToken(active.encryptedToken) };
      }
    }
  }

  throw new Error("Unable to issue rotating QR token");
}

async function currentToken(): Promise<{ token: AttendanceToken; rawToken: string }> {
  const [active] = await db
    .select()
    .from(attendanceTokensTable)
    .where(
      and(
        eq(attendanceTokensTable.isActive, true),
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
      }),
    );
  },
);

router.post(
  "/attendance/scan",
  requireAuthenticated,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const parsed = ScanAttendanceQrBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Código QR inválido" });
      return;
    }

    const clientIp =
      req.ip || req.socket.remoteAddress || "unknown";
    const scanKey = `${req.clerkUserId}:${clientIp}`;
    if (!canAttemptScan(scanKey)) {
      req.log.warn({ clerkUserId: req.clerkUserId }, "QR scan rate limit exceeded");
      res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
      return;
    }

    const employee = req.employee!;
    const now = new Date();
    const tokenHash = hashToken(parsed.data.token);

    const event = await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(attendanceTokensTable)
        .set({ usedAt: now, isActive: false })
        .where(
          and(
            eq(attendanceTokensTable.tokenHash, tokenHash),
            eq(attendanceTokensTable.isActive, true),
            isNull(attendanceTokensTable.usedAt),
            gt(attendanceTokensTable.expiresAt, now),
          ),
        )
        .returning();

      if (!consumed) {
        return null;
      }

      const events = await tx
        .select()
        .from(attendanceEventsTable)
        .where(eq(attendanceEventsTable.employeeId, employee.id))
        .orderBy(desc(attendanceEventsTable.occurredAt))
        .limit(50);
      const today = bogotaDay(now);
      const todayLatest = events.find(
        (item) => bogotaDay(item.occurredAt) === today,
      );
      const [created] = await tx
        .insert(attendanceEventsTable)
        .values({
          id: randomUUID(),
          employeeId: employee.id,
          type: todayLatest?.type === "check_in" ? "check_out" : "check_in",
          occurredAt: now,
          location: null,
          deviceLabel: null,
        })
        .returning();

      const next = newTokenValues();
      await tx.insert(attendanceTokensTable).values(next.values);
      return created;
    });

    if (!event) {
      req.log.warn({ clerkUserId: req.clerkUserId }, "QR token rejected");
      res.status(400).json({ error: "El QR expiró, ya fue utilizado o no es válido." });
      return;
    }

    clearScanAttempts(scanKey);
    res.json(ScanAttendanceQrResponse.parse(eventResponse(event, employee)));
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
    const events = rows
      .filter((row) => !filterDay || bogotaDay(row.event.occurredAt) === filterDay)
      .map((row) => eventResponse(row.event, row.employee));

    res.json(ListAttendanceEventsResponse.parse(events));
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
    const late = todayRows.filter((row) => {
      if (row.event.type !== "check_in") return false;
      const hour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Bogota",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(row.event.occurredAt),
      );
      return hour >= 9;
    });
    const last = todayRows[0];

    res.json(
      GetAttendanceSummaryResponse.parse({
        present: present.length,
        expected: employees.length,
        late: late.length,
        checkedOut: [...latestByEmployee.values()].filter(
          (row) => row.event.type === "check_out",
        ).length,
        lastEvent: last ? eventResponse(last.event, last.employee) : null,
      }),
    );
  },
);

export default router;