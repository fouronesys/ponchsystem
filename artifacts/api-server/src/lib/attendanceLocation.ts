const DEFAULT_SITE_LATITUDE = 19.44739;
const DEFAULT_SITE_LONGITUDE = -70.677598;
const DEFAULT_RADIUS_METERS = 200;
const DEFAULT_MAX_ACCURACY_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_008.8;

export type AttendanceLocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type ValidatedAttendanceLocation = AttendanceLocationInput & {
  distanceMeters: number;
};

export type AttendanceLocationErrorCode =
  | "LOCATION_REQUIRED"
  | "LOCATION_INVALID"
  | "LOCATION_INACCURATE"
  | "OUTSIDE_ATTENDANCE_RADIUS";

export class AttendanceLocationError extends Error {
  readonly code: AttendanceLocationErrorCode;

  constructor(code: AttendanceLocationErrorCode, message: string) {
    super(message);
    this.name = "AttendanceLocationError";
    this.code = code;
  }
}

function configuredNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

export const attendanceSiteConfig = {
  latitude: configuredNumber("ATTENDANCE_SITE_LATITUDE", DEFAULT_SITE_LATITUDE, -90, 90),
  longitude: configuredNumber("ATTENDANCE_SITE_LONGITUDE", DEFAULT_SITE_LONGITUDE, -180, 180),
  radiusMeters: configuredNumber(
    "ATTENDANCE_RADIUS_METERS",
    DEFAULT_RADIUS_METERS,
    1,
    10_000,
  ),
  maxAccuracyMeters: configuredNumber(
    "ATTENDANCE_MAX_ACCURACY_METERS",
    DEFAULT_MAX_ACCURACY_METERS,
    1,
    10_000,
  ),
} as const;

function isLocationInput(value: unknown): value is AttendanceLocationInput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude) &&
    typeof candidate.accuracy === "number" &&
    Number.isFinite(candidate.accuracy)
  );
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceBetweenCoordinates(
  first: Pick<AttendanceLocationInput, "latitude" | "longitude">,
  second: Pick<AttendanceLocationInput, "latitude" | "longitude">,
): number {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function validateAttendanceLocation(
  value: unknown,
): ValidatedAttendanceLocation {
  if (value == null) {
    throw new AttendanceLocationError(
      "LOCATION_REQUIRED",
      "Necesitamos tu ubicación para registrar la asistencia.",
    );
  }
  if (!isLocationInput(value)) {
    throw new AttendanceLocationError(
      "LOCATION_INVALID",
      "La ubicación recibida no es válida. Inténtalo de nuevo.",
    );
  }

  const { latitude, longitude, accuracy } = value;
  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy < 0
  ) {
    throw new AttendanceLocationError(
      "LOCATION_INVALID",
      "La ubicación recibida no es válida. Inténtalo de nuevo.",
    );
  }
  if (accuracy > attendanceSiteConfig.maxAccuracyMeters) {
    throw new AttendanceLocationError(
      "LOCATION_INACCURATE",
      "La ubicación es demasiado imprecisa. Activa la ubicación precisa e inténtalo de nuevo.",
    );
  }

  const distanceMeters = distanceBetweenCoordinates(
    { latitude: attendanceSiteConfig.latitude, longitude: attendanceSiteConfig.longitude },
    { latitude, longitude },
  );
  if (distanceMeters > attendanceSiteConfig.radiusMeters) {
    throw new AttendanceLocationError(
      "OUTSIDE_ATTENDANCE_RADIUS",
      "Debes estar en la instalación autorizada para registrar la asistencia.",
    );
  }

  return { latitude, longitude, accuracy, distanceMeters };
}

export function serializeLocationEvidence(location: AttendanceLocationInput): string {
  return JSON.stringify({
    latitude: Number(location.latitude.toFixed(6)),
    longitude: Number(location.longitude.toFixed(6)),
    accuracy: Number(location.accuracy.toFixed(1)),
  });
}