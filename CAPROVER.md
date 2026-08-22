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
| `SESSION_SECRET` | Sí | Cifrado y firma de tokens QR |
| `INITIAL_ADMIN_USERNAME` | Solo primer arranque | Usuario del primer administrador local |
| `INITIAL_ADMIN_PASSWORD` | Solo primer arranque | Contraseña de al menos 8 caracteres del primer administrador |
| `INITIAL_ADMIN_NAME` | No | Nombre visible del primer administrador |
| `LOG_LEVEL` | No | Por defecto `info` |
| `SQLITE_DATABASE_PATH` | No | Por defecto `/app/data/attendance.sqlite` |

CapRover proporciona `PORT=80` en la imagen. No sobrescribas `FRONTEND_DIST_DIR`
salvo que cambies la ubicación del frontend.

## 3. Datos persistentes y backups

En el primer arranque, la aplicación crea las tablas SQLite automáticamente en
el volumen montado. No configures `DATABASE_URL` ni instales PostgreSQL para
esta modalidad.

El archivo `attendance.sqlite` contiene credenciales locales hasheadas,
sesiones, eventos de asistencia y tokens QR. Las fotos de perfil y selfies se
guardan en `/app/data/uploads`, fuera de SQLite. Haz copias de seguridad periódicas de la carpeta persistente
`/app/data` desde el host de CapRover. Un volumen protege contra redeploys, pero
no sustituye un backup independiente.

## 4. Administrador inicial

No existe un registro público. En el primer arranque, la aplicación crea el
administrador exclusivamente a partir de `INITIAL_ADMIN_USERNAME` y
`INITIAL_ADMIN_PASSWORD`; si esas variables no existen, no crea ninguna cuenta.
Esto evita que quien visite primero el dominio obtenga permisos de consola.
Guarda la contraseña como secreto de CapRover y, una vez creado el
administrador, elimina la variable `INITIAL_ADMIN_PASSWORD` antes de futuros
despliegues.

El administrador crea las cuentas de empleados desde la consola. Cada empleado
inicia sesión con usuario y contraseña, toma una selfie con la cámara frontal y
escanea un QR de un solo uso para cada entrada o salida. No se aplica
reconocimiento facial automático; las selfies son evidencia disponible solo
para el empleado asociado o para administradores autenticados.

## Build local opcional

```bash
docker build -t control-asistencia .
docker run --rm -p 8080:80 \
  -e SESSION_SECRET='genera-un-secreto-largo' \
  -e INITIAL_ADMIN_USERNAME='admin' \
  -e INITIAL_ADMIN_PASSWORD='una-clave-larga-de-prueba' \
  -v control-asistencia-data:/app/data \
  control-asistencia
```