---
name: SQLite transaction callbacks
description: Constraint for Drizzle transactions backed by better-sqlite3 in this workspace.
---

Use synchronous transaction callbacks with the better-sqlite3 Drizzle driver. Execute mutating statements with `.run()` inside the callback; do not mark the callback `async` or await its statements.

**Why:** better-sqlite3 rejects transaction callbacks that return a Promise, so an async callback throws before the transaction body completes.

**How to apply:** When a feature needs an atomic series of SQLite writes, wrap the synchronous `.run()` calls in `db.transaction((tx) => { ... })`. Await only the transaction call at its outer async boundary if needed.