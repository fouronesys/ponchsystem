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
    clerkUserId: text("clerk_user_id").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("employee"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("employees_clerk_user_id_unique").on(table.clerkUserId),
  ],
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
export type AttendanceToken = typeof attendanceTokensTable.$inferSelect;
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertAttendanceToken = z.infer<typeof insertAttendanceTokenSchema>;
export type InsertAttendanceEvent = z.infer<typeof insertAttendanceEventSchema>;