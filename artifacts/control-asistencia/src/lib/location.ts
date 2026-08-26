export type AttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export class AttendanceLocationClientError extends Error {
  readonly code: "unsupported" | "denied" | "unavailable" | "timeout";

  constructor(
    code: AttendanceLocationClientError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AttendanceLocationClientError";
    this.code = code;
  }
}

export function getCurrentAttendanceLocation(): Promise<AttendanceLocation> {
  if (!navigator.geolocation) {
    return Promise.reject(
      new AttendanceLocationClientError(
        "unsupported",
        "Este navegador no admite la ubicación. No puedes registrar la asistencia desde aquí.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) ||
          !Number.isFinite(coords.accuracy)
        ) {
          reject(
            new AttendanceLocationClientError(
              "unavailable",
              "No pudimos obtener una ubicación válida. Activa la ubicación e inténtalo de nuevo.",
            ),
          );
          return;
        }
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        });
      },
      (error) => {
        const details =
          error.code === GeolocationPositionError.PERMISSION_DENIED
            ? ["denied", "Permite el acceso a tu ubicación para registrar la asistencia."]
            : error.code === GeolocationPositionError.TIMEOUT
              ? ["timeout", "La ubicación tardó demasiado. Inténtalo de nuevo en un lugar con mejor señal."]
              : ["unavailable", "No pudimos obtener tu ubicación. Activa la ubicación e inténtalo de nuevo."];
        reject(
          new AttendanceLocationClientError(
            details[0] as AttendanceLocationClientError["code"],
            details[1]!,
          ),
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
    );
  });
}

export function locationPrecisionLabel(accuracy: number): string {
  return `Precisión aproximada: ±${Math.max(1, Math.round(accuracy))} m`;
}