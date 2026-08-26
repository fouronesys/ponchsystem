import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AttendanceLocationError,
  attendanceSiteConfig,
  distanceBetweenCoordinates,
  serializeLocationEvidence,
  validateAttendanceLocation,
} from "./lib/attendanceLocation";

const center = {
  latitude: attendanceSiteConfig.latitude,
  longitude: attendanceSiteConfig.longitude,
};

test("acepta una ubicación precisa dentro del radio autorizado", () => {
  const result = validateAttendanceLocation({
    ...center,
    accuracy: 12.4,
  });

  assert.ok(result.distanceMeters <= attendanceSiteConfig.radiusMeters);
  assert.deepEqual(JSON.parse(serializeLocationEvidence(result)), {
    latitude: center.latitude,
    longitude: center.longitude,
    accuracy: 12.4,
  });
});

test("rechaza ubicación ausente, inválida o imprecisa con códigos diferenciados", () => {
  assert.throws(
    () => validateAttendanceLocation(undefined),
    (error: unknown) =>
      error instanceof AttendanceLocationError && error.code === "LOCATION_REQUIRED",
  );
  assert.throws(
    () =>
      validateAttendanceLocation({
        latitude: 91,
        longitude: center.longitude,
        accuracy: 10,
      }),
    (error: unknown) =>
      error instanceof AttendanceLocationError && error.code === "LOCATION_INVALID",
  );
  assert.throws(
    () => validateAttendanceLocation({ ...center, accuracy: 101 }),
    (error: unknown) =>
      error instanceof AttendanceLocationError && error.code === "LOCATION_INACCURATE",
  );
});

test("rechaza una ubicación fuera de los 200 metros configurados", () => {
  const outside = {
    latitude: center.latitude + 0.003,
    longitude: center.longitude,
    accuracy: 10,
  };
  assert.ok(
    distanceBetweenCoordinates(center, outside) > attendanceSiteConfig.radiusMeters,
  );
  assert.throws(
    () => validateAttendanceLocation(outside),
    (error: unknown) =>
      error instanceof AttendanceLocationError &&
      error.code === "OUTSIDE_ATTENDANCE_RADIUS",
  );
});