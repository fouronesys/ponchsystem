---
name: OpenAPI numeric validation
description: Compatibility constraint for numeric OpenAPI schema fields in the generated Zod validation package.
---

Use `type: number` for API counters and duration values in this workspace instead of `type: integer`.

**Why:** The currently installed OpenAPI generator emits `zod.int()` for integer fields, but the workspace's Zod version does not provide that API, which breaks the generated package typecheck.

**How to apply:** For whole-number domain counters, keep the API contract as a number and enforce whole-number semantics in server-side business validation if it matters. Revisit this once the generator or Zod version changes.