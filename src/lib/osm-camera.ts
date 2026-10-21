export type CameraLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

/** The browser reports a position; it is not independent proof of GPS location. */
export function cameraLocation(
  position: Pick<GeolocationPosition, "coords" | "timestamp">,
  now = Date.now(),
): CameraLocation {
  const { latitude, longitude, accuracy } = position.coords;
  if (
    ![latitude, longitude, accuracy, position.timestamp].every(
      Number.isFinite,
    ) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    accuracy <= 0 ||
    accuracy > 1_000_000 ||
    now - position.timestamp > 20_000 ||
    position.timestamp > now + 2_000
  )
    throw new Error(
      "ताज़ा स्थान नहीं मिला। फिर कोशिश करें या फ़ाइल अपलोड करें। / No fresh location reading. Retry or upload a file.",
    );
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: new Date(now).toISOString(),
  };
}

export function openStreetMapUrl(
  location: Pick<CameraLocation, "latitude" | "longitude">,
) {
  const lat = location.latitude.toFixed(6);
  const lon = location.longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

export function openStreetMapEmbedUrl(
  location: Pick<CameraLocation, "latitude" | "longitude">,
) {
  const { latitude: lat, longitude: lon } = location;
  const bbox = [
    Math.max(-180, lon - 0.006),
    Math.max(-90, lat - 0.004),
    Math.min(180, lon + 0.006),
    Math.min(90, lat + 0.004),
  ].join(",");
  const params = new URLSearchParams({
    bbox,
    layer: "mapnik",
    marker: `${lat},${lon}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}
