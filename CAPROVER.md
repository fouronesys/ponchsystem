# Despliegue en CapRover

La aplicación se despliega como un solo contenedor. Express sirve la interfaz
compilada y el API continúa disponible bajo `/api`, ambos en el mismo dominio.

## 1. Crear PostgreSQL persistente

Crea PostgreSQL como una aplicación separada en CapRover, usando la imagen o
plantilla oficial de PostgreSQL:

1. Define `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` al crearla.
2. Añade un volumen persistente con ruta dentro del contenedor:
   `/var/lib/postgresql/data`.
3. No uses una ruta temporal ni dependas del filesystem del contenedor.
4. Conserva estas credenciales en el gestor de secretos de CapRover.

Después, la aplicación web puede usar el nombre interno de la app PostgreSQL en
su conexión, por ejemplo:

```text
postgresql://POSTGRES_USER:POSTGRES_PASSWORD@attendance-db:5432/POSTGRES_DB
```

Codifica cualquier carácter especial de usuario o contraseña dentro de la URL.
Si PostgreSQL está en otro servidor, usa su hostname privado y exige SSL según
el proveedor.

## 2. Crear la aplicación web

1. Crea una aplicación nueva en CapRover.
2. En **Deployment**, selecciona despliegue desde el repositorio o sube el
   proyecto con `captain-definition` en la raíz.
3. Usa el puerto interno `80`.
4. Activa HTTPS y fuerza HTTPS desde el dominio de CapRover.
5. Configura el health check en `GET /api/healthz`.

## 2. Variables de entorno

Configura estas variables en **App Configs > Environmental Variables**:

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sí | URL hacia la app PostgreSQL persistente |
| `CLERK_SECRET_KEY` | Sí | Validación de sesiones en el servidor |
| `CLERK_PUBLISHABLE_KEY` | Sí | Configuración de Clerk en el servidor |
| `SESSION_SECRET` | Sí | Cifrado y firma de tokens QR |
| `ADMIN_CLERK_USER_IDS` | Sí | IDs de Clerk con acceso a la consola, separados por comas |
| `LOG_LEVEL` | No | Por defecto `info` |

CapRover proporciona `PORT=80` en la imagen. No sobrescribas `FRONTEND_DIST_DIR`
salvo que cambies la ubicación del frontend.

## 3. Configuración de Clerk

La clave publicable se inyecta al arrancar el contenedor desde
`CLERK_PUBLISHABLE_KEY`; no necesitas configurar argumentos de build. La clave
es pública, pero `CLERK_SECRET_KEY` nunca debe estar en argumentos de build ni
en archivos del repositorio. Ambas deben existir como variables runtime de
CapRover.

En Clerk, añade el dominio público de CapRover como dominio permitido y
configura las URLs de inicio de sesión y redirección para `/sign-in` y
`/sign-up`.

## 4. PostgreSQL y datos

Antes del primer uso, aplica el esquema de producción sobre la base persistente.
Desde una copia del proyecto con acceso a la red de PostgreSQL:

```bash
DATABASE_URL='postgresql://...' pnpm --filter @workspace/db run push
```

Haz un backup antes de cambios de esquema y no uses el seed de demostración en
producción. La app no guarda asistencia en el filesystem: todos los registros,
empleados, eventos y tokens viven en PostgreSQL.

Configura además backups periódicos del volumen o del proveedor PostgreSQL.
Un volumen persistente protege contra redeploys, pero no sustituye backups.

## 5. Administrador inicial

No se habilita automáticamente al primer usuario. Después de crear la cuenta
administradora en Clerk, agrega su `user_id` a `ADMIN_CLERK_USER_IDS` y
redeploya la aplicación. Esto evita que alguien que llegue primero al dominio
obtenga acceso administrativo.

## Build local opcional

```bash
docker build -t control-asistencia .
docker run --rm -p 8080:80 \
  -e DATABASE_URL='postgresql://...' \
  -e CLERK_SECRET_KEY='sk_test_xxx' \
  -e CLERK_PUBLISHABLE_KEY='pk_test_xxx' \
  -e SESSION_SECRET='genera-un-secreto-largo' \
  -e ADMIN_CLERK_USER_IDS='user_xxx' \
  control-asistencia
```