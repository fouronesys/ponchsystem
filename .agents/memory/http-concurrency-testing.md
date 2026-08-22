---
name: HTTP concurrency testing
description: Coordinating end-to-end requests that contend with synchronous SQLite cleanup.
---

When an HTTP concurrency test must prove a successful request, establish that request's outcome before launching an unrelated operation that can invalidate its credential; keep the cleanup operation active with bounded, yielded batches.

**Why:** Native fetch scheduling does not guarantee that a request started first reaches Express first, so rotating a QR token at the same time can make a valid test fail for ordering reasons rather than application behavior.

**How to apply:** Start cleanup and the protected scan together, await the scan response, then exercise rotation and display-link reads while cleanup continues; separately assert token single-use.