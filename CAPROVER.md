# Despliegue en CapRover

La aplicación se despliega como un solo contenedor. Express sirve la interfaz
compilada y el API continúa disponible bajo `/api`, ambos en el mismo dominio.

## 1. Crear la aplicación web

1. Crea una aplicación nueva en CapRover.
2. En **Deployment**, selecciona despliegue desde el repositorio o sube el
   proyecto con `captain-definition` en la raíz.
3. Usa el puerto interno `80`.
4. Activa HTTPS y fuerza HTTPS desde el dominio de CapRover.
5. Configura el health check en `GET /api/healthz`.
6. En **Persistent Directories**, crea un volumen persistente en:

   ```text
   /app/data
   ```

La aplicación almacena SQLite en `/app/data/attendance.sqlite`. CapRover
conserva esa carpeta cuando se actualiza o reinicia el contenedor.

## 2. Variables de entorno

Configura estas variables en **App Configs > Environmental Variables**:

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `CLERK_SECRET_KEY` | Sí | Validación de sesiones en el servidor |
| `CLERK_PUBLISHABLE_KEY` | Sí | Configuración de Clerk en el servidor |
| `SESSION_SECRET` | Sí | Cifrado y firma de tokens QR |
| `ADMIN_CLERK_USER_IDS` | Sí | IDs de Clerk con acceso a la consola, separados por comas |
| `LOG_LEVEL` | No | Por defecto `info` |
| `SQLITE_DATABASE_PATH` | No | Por defecto `/app/data/attendance.sqlite` |

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

## 4. Datos persistentes y backups

En el primer arranque, la aplicación crea las tablas SQLite automáticamente en
el volumen montado. No configures `DATABASE_URL` ni instales PostgreSQL para
esta modalidad.

El archivo `attendance.sqlite` contiene empleados, eventos de asistencia y
tokens QR. Haz copias de seguridad periódicas de la carpeta persistente
`/app/data` desde el host de CapRover. Un volumen protege contra redeploys, pero
no sustituye un backup independiente.

## 5. Administrador inicial

No se habilita automáticamente al primer usuario. Después de crear la cuenta
administradora en Clerk, agrega su `user_id` a `ADMIN_CLERK_USER_IDS` y
redeploya la aplicación. Esto evita que alguien que llegue primero al dominio
obtenga acceso administrativo.

## Build local opcional

```bash
docker build -t control-asistencia .
docker run --rm -p 8080:80 \
  -e CLERK_SECRET_KEY='sk_test_xxx' \
  -e CLERK_PUBLISHABLE_KEY='pk_test_xxx' \
  -e SESSION_SECRET='genera-un-secreto-largo' \
  -e ADMIN_CLERK_USER_IDS='user_xxx' \
  -v control-asistencia-data:/app/data \
  control-asistencia
```