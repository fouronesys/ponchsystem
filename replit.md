# Control de Asistencia

Sistema web seguro para registrar entradas y salidas de empleados mediante QR rotativos.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- SQLite uses `data/attendance.sqlite` by default; set `SQLITE_DATABASE_PATH` to override it.

## CapRover

- `docker build -t control-asistencia .`
- `captain-definition` y `Dockerfile` despliegan el frontend y API en un solo contenedor.
- Variables runtime requeridas: `SESSION_SECRET`, `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` (solo para crear el primer administrador local).
- En CapRover, monta `/app/data` como directorio persistente para conservar SQLite.
- Consulta `CAPROVER.md` para el health check, SQLite persistente, fotos y configuración del administrador local.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
