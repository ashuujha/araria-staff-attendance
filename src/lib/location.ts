/** Browser positions are device reports, not independently verified GPS fixes. */
export function validateDevicePosition(
  position: GeolocationPosition,
  now = Date.now(),
  maxAgeMs = 10_000,
): boolean {
  const { latitude, longitude, accuracy } = position.coords;
  return (
    [latitude, longitude, accuracy, position.timestamp].every(
      Number.isFinite,
    ) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    accuracy > 0 &&
    accuracy <= 50 &&
    now - position.timestamp <= maxAgeMs &&
    position.timestamp <= now + 2_000
  );
}

function distance(a: GeolocationPosition, b: GeolocationPosition) {
  const rad = Math.PI / 180;
  const lat = (b.coords.latitude - a.coords.latitude) * rad;
  const lng = (b.coords.longitude - a.coords.longitude) * rad;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a.coords.latitude * rad) *
      Math.cos(b.coords.latitude * rad) *
      Math.sin(lng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

type LocationOptions = {
  settleMs?: number;
  timeoutMs?: number;
  maxAgeMs?: number;
  now?: () => number;
};

/** Wait for fresh, accurate readings and allow newer fixes to replace the first. */
export function getFreshLocation(
  geolocation: Geolocation,
  signal?: AbortSignal,
  options: LocationOptions = {},
): Promise<GeolocationPosition> {
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxAgeMs = options.maxAgeMs ?? 10_000;
  return new Promise((resolve, reject) => {
    let candidate: GeolocationPosition | undefined;
    let watchId: number | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (error?: Error, position?: GeolocationPosition) => {
      if (done) return;
      done = true;
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      clearTimeout(settleTimer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(position!);
    };
    const abort = () =>
      finish(new DOMException("Location request cancelled", "AbortError"));
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    const failure = () =>
      new Error(
        "ताज़ा और स्थिर स्थान नहीं मिला। खुले स्थान में फिर कोशिश करें। / No fresh, stable location within 50 metres accuracy. Try again outdoors.",
      );
    deadline = setTimeout(() => finish(failure()), timeoutMs);
    const success = (position: GeolocationPosition) => {
      if (done || !validateDevicePosition(position, now(), maxAgeMs)) return;
      if (candidate && position.timestamp < candidate.timestamp) return;
      const changed =
        candidate &&
        distance(candidate, position) >
          Math.max(
            100,
            (candidate.coords.accuracy + position.coords.accuracy) * 2,
          );
      if (!candidate || changed) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (candidate && validateDevicePosition(candidate, now(), maxAgeMs))
            finish(undefined, candidate);
          else finish(failure());
        }, settleMs);
      }
      candidate = position;
    };
    const error = (error: GeolocationPositionError) => {
      if (error.code === 1)
        finish(
          new Error(
            "स्थान की अनुमति दें और फिर कोशिश करें। / Location permission denied. Allow location access in your browser and try again.",
          ),
        );
      // A temporary timeout or unavailable reading can recover while watching.
    };
    const browserOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: timeoutMs,
    };
    try {
      if (typeof geolocation.watchPosition === "function") {
        watchId = geolocation.watchPosition(success, error, browserOptions);
        // Test doubles and some implementations can call back synchronously.
        if (done) geolocation.clearWatch(watchId);
      } else {
        geolocation.getCurrentPosition(success, error, browserOptions);
      }
    } catch (error) {
      finish(error instanceof Error ? error : failure());
    }
  });
}
