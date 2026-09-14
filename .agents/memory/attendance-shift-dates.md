---
name: Attendance shift dates
description: Durable rule for assigning attendance events and report rows to scheduled workdays.
---

An attendance event belongs to the workday that started the employee's scheduled shift, not necessarily to its local calendar date. For an overnight shift, the exact configured end time is still part of the previous workday.

**Why:** A checkout at or before 01:00 can otherwise be reported as an event on the next day, producing incomplete pairs and incorrect administrative totals.

**How to apply:** Keep schedule-start dates separate from event-effective dates, use the employee's weekly schedule to assign overnight events, and include the following local calendar day when loading a report range that may end with an overnight shift.