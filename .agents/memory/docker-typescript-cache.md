---
name: Docker TypeScript cache
description: Prevent false-success incremental TypeScript state from breaking clean Docker builds.
---

Do not send `.tsbuildinfo` files into a Docker build context when the generated
`dist` directories are excluded.

**Why:** TypeScript can trust incremental metadata that claims declaration
outputs are current even when Docker has not received those outputs. Downstream
projects then fail with missing declaration errors in an otherwise clean image.

**How to apply:** Keep both generated build outputs and TypeScript incremental
metadata out of the Docker context, so `tsc --build` regenerates a consistent
set of declarations during the container build.