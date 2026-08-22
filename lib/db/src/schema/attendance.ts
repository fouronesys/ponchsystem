import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    documentNumber: text("document_number"),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    profilePhotoPath: text("profile_photo_path"),
    role: text("role").notNull().default("employee"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("employees_username_unique").on(table.username),
  ],
);

export const authSessionsTable = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    loginAt: integer("login_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const loginEventsTable = sqliteTable(
  "login_events",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    success: integer("success", { mode: "boolean" }).notNull(),
    ipAddress: text("ip_address"),
    deviceLabel: text("device_label"),
  },
  (table) => [index("login_events_employee_time_idx").on(table.employeeId, table.occurredAt)],
);

export const attendanceTokensTable = sqliteTable(
  "attendance_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("attendance_tokens_hash_unique").on(table.tokenHash),
    uniqueIndex("attendance_tokens_one_active_unique")
      .on(table.isActive)
      .where(sql`${table.isActive} = 1`),
    index("attendance_tokens_validation_idx").on(
      table.tokenHash,
      table.isActive,
      table.expiresAt,
    ),
  ],
);

export const attendanceEventsTable = sqliteTable(
  "attendance_events",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    location: text("location"),
    deviceLabel: text("device_label"),
    sessionId: text("session_id").references(() => authSessionsTable.id, {
      onDelete: "set null",
    }),
    loginAt: integer("login_at", { mode: "timestamp_ms" }),
    selfiePath: text("selfie_path"),
  },
  (table) => [
    index("attendance_events_employee_time_idx").on(
      table.employeeId,
      table.occurredAt,
    ),
    index("attendance_events_time_idx").on(table.occurredAt),
  ],
);

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  createdAt: true,
});
export const insertAttendanceTokenSchema =
  createInsertSchema(attendanceTokensTable).omit({ createdAt: true });
export const insertAttendanceEventSchema = createInsertSchema(
  attendanceEventsTable,
).omit({ occurredAt: true });

export type Employee = typeof employeesTable.$inferSelect;
export type AuthSession = typeof authSessionsTable.$inferSelect;
export type AttendanceToken = typeof attendanceTokensTable.$inferSelect;
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertAttendanceToken = z.infer<typeof insertAttendanceTokenSchema>;
export type InsertAttendanceEvent = z.infer<typeof insertAttendanceEventSchema>;