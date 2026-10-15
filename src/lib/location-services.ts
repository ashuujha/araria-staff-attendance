import sharp from "sharp";
import { HttpError } from "./server";

export const MAP_ATTRIBUTION = "© OpenStreetMap contributors";
const DAY = 86400000;
const addressCache = new Map<
  string,
  { value: string | null; expires: number }
>();
const tileCache = new Map<string, { value: Buffer; expires: number }>();
const tileValidators = new Map<string, { etag?: string; modified?: string }>();
const mapCache = new Map<string, { value: Buffer | null; expires: number }>();
const flights = new Map<string, Promise<unknown>>();
const nextRequest = new Map<string, number>();

export function coordinatePair(latitude: unknown, longitude: unknown) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    throw new HttpError(400, "मान्य latitude और longitude दें।");
  return { latitude, longitude };
}
export function requestCoordinates(req: Request) {
  const query = new URL(req.url).searchParams;
  const lat = query.get("lat"),
    lon = query.get("lon");
  if (!lat?.trim() || !lon?.trim())
    throw new HttpError(400, "स्थान आवश्यक है।");
  return coordinatePair(Number(lat), Number(lon));
}
function providerUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
  )
    throw new Error("Invalid location provider configuration");
  return url;
}
function headers() {
  const site =
    process.env.APP_URL || "https://araria-staff-attendance.vercel.app";
  return {
    "User-Agent": `ArariaStaffAttendance/1.0 (+${site})`,
    Referer: site,
    Accept: "application/json,image/png",
  };
}
async function upstream(url: URL, conditional: Record<string, string> = {}) {
  const provider = url.hostname;
  const now = Date.now(),
    slot = Math.max(now, nextRequest.get(provider) || 0);
  if (slot - now > 6000) throw new Error("Location provider busy");
  nextRequest.set(provider, slot + 1000);
  if (slot > now)
    await new Promise((resolve) => setTimeout(resolve, slot - now));
  const response = await fetch(url, {
    headers: { ...headers(), ...conditional },
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok && response.status !== 304)
    throw new Error("Location service unavailable");
  return response;
}
async function boundedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new Error("Location response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty location response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Location response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
async function cached<T>(
  key: string,
  cache: Map<string, { value: T; expires: number }>,
  capacity: number,
  load: () => Promise<{ value: T; ttl: number }>,
): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  if (flights.has(key)) return flights.get(key) as Promise<T>;
  const promise = (async () => {
    const result = await load();
    if (cache.size >= capacity && !cache.has(key)) {
      // Bounded memory. Fresh tile entries are not evicted and re-downloaded.
      for (const [oldKey, old] of cache)
        if (old.expires < Date.now()) cache.delete(oldKey);
    }
    if (cache.size < capacity || cache.has(key))
      cache.set(key, { value: result.value, expires: Date.now() + result.ttl });
    return result.value;
  })();
  flights.set(key, promise);
  try {
    return await promise;
  } finally {
    flights.delete(key);
  }
}
function coordKey(lat: number, lon: number) {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}
export async function getLocationDetails(lat: number, lon: number) {
  coordinatePair(lat, lon);
  const address = await cached(
    `address:${coordKey(lat, lon)}`,
    addressCache,
    1024,
    async () => {
      try {
        const url = providerUrl(
          process.env.PHOTON_REVERSE_URL || "https://photon.komoot.io/reverse",
        );
        url.searchParams.set("lat", lat.toFixed(6));
        url.searchParams.set("lon", lon.toFixed(6));
        url.searchParams.set("limit", "1");
        url.searchParams.set("lang", "en");
        url.searchParams.set("radius", "1");
        const response = await upstream(url);
        const data = JSON.parse(
          (await boundedBytes(response, 128 * 1024)).toString("utf8"),
        );
        const feature = data.features?.[0];
        const p = feature?.properties;
        if (!p || typeof p !== "object") return { value: null, ttl: 60000 };
        const clean = (value: unknown) =>
          typeof value === "string"
            ? value
                .replace(/[\u0000-\u001f<>]/g, " ")
                .trim()
                .slice(0, 150)
            : "";
        const street = [clean(p.housenumber), clean(p.street)]
          .filter(Boolean)
          .join(" ");
        const parts = [
          clean(p.name),
          street,
          clean(p.district),
          clean(p.city),
          clean(p.county),
          clean(p.state),
          clean(p.postcode),
          clean(p.country),
        ].filter(Boolean);
        const address = [...new Set(parts)].join(", ").slice(0, 500) || null;
        return { value: address, ttl: address ? DAY : 60000 };
      } catch {
        return { value: null, ttl: 60000 };
      }
    },
  );
  return {
    address,
    source: "Photon / OpenStreetMap",
    attribution: MAP_ATTRIBUTION,
    available: Boolean(address),
  };
}
export function mapGeometry(lat: number, lon: number) {
  coordinatePair(lat, lon);
  const zoom = 16,
    size = 256 * 2 ** zoom;
  const phi =
    (Math.min(85.05112878, Math.max(-85.05112878, lat)) * Math.PI) / 180;
  const x = ((lon + 180) / 360) * size;
  const y =
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size;
  return {
    zoom,
    x,
    y,
    left: Math.floor(x - 128),
    top: Math.floor(y - 90),
    width: 256,
    height: 180,
  };
}
function tileTtl(response: Response) {
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(
    response.headers.get("cache-control") || "",
  );
  if (maxAge) return Math.max(1000, Number(maxAge[1]) * 1000);
  const expires = Date.parse(response.headers.get("expires") || "");
  return Number.isFinite(expires) && expires > Date.now()
    ? expires - Date.now()
    : 7 * DAY;
}
async function getTile(z: number, x: number, y: number) {
  const count = 2 ** z;
  const tileX = ((x % count) + count) % count,
    tileY = Math.min(count - 1, Math.max(0, y));
  const base = providerUrl(
    process.env.OSM_TILE_BASE_URL || "https://tile.openstreetmap.org/",
  );
  const key = `tile:${base.origin}${base.pathname}:${z}/${tileX}/${tileY}`;
  // If tile cache is full, avoid downloading tiles that cannot be retained.
  if (
    tileCache.size >= 512 &&
    !tileCache.has(key) &&
    ![...tileCache.values()].some((entry) => entry.expires < Date.now())
  )
    throw new Error("Tile cache capacity reached");
  return cached(key, tileCache, 512, async () => {
    const url = new URL(`${z}/${tileX}/${tileY}.png`, base);
    const previous = tileCache.get(key);
    const validators = tileValidators.get(key);
    const conditional: Record<string, string> = {};
    if (previous && validators?.etag)
      conditional["If-None-Match"] = validators.etag;
    if (previous && validators?.modified)
      conditional["If-Modified-Since"] = validators.modified;
    const response = await upstream(url, conditional);
    if (response.status === 304 && previous)
      return { value: previous.value, ttl: tileTtl(response) };
    const etag = response.headers.get("etag"),
      modified = response.headers.get("last-modified");
    tileValidators.set(key, {
      ...(etag ? { etag } : {}),
      ...(modified ? { modified } : {}),
    });
    const bytes = await boundedBytes(response, 512 * 1024);
    const metadata = await sharp(bytes, {
      limitInputPixels: 65536,
      failOn: "warning",
    }).metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== 256 ||
      metadata.height !== 256
    )
      throw new Error("Invalid map tile");
    return { value: bytes, ttl: tileTtl(response) };
  });
}
export async function getMapThumbnail(lat: number, lon: number) {
  coordinatePair(lat, lon);
  // Near Mercator poles no faithful local raster thumbnail is available.
  if (Math.abs(lat) > 85.05112878) return null;
  return cached(`map:${lat},${lon}`, mapCache, 512, async () => {
    try {
      const g = mapGeometry(lat, lon);
      const x0 = Math.floor(g.left / 256),
        x1 = Math.floor((g.left + g.width - 1) / 256);
      const y0 = Math.floor(g.top / 256),
        y1 = Math.floor((g.top + g.height - 1) / 256);
      const tiles = [];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          tiles.push({
            input: await getTile(g.zoom, x, y),
            left: (x - x0) * 256,
            top: (y - y0) * 256,
          });
      const canvas = await sharp({
        create: {
          width: (x1 - x0 + 1) * 256,
          height: (y1 - y0 + 1) * 256,
          channels: 3,
          background: "white",
        },
      })
        .composite(tiles)
        .png()
        .toBuffer();
      const markerX = g.x - g.left,
        markerY = g.y - g.top;
      const overlay = `<svg width="256" height="180"><g transform="translate(${markerX},${markerY})"><path d="M0 0 C-5 -8 -14 -15 -14 -25 A14 14 0 1 1 14 -25 C14 -15 5 -8 0 0" fill="#d71920" stroke="white" stroke-width="2"/><circle cy="-25" r="5" fill="white"/></g><rect y="164" width="256" height="16" fill="white" fill-opacity="0.94"/><text x="4" y="175" font-size="11" fill="#111" font-family="sans-serif">© OpenStreetMap contributors</text></svg>`;
      const value = await sharp(canvas)
        .extract({
          left: g.left - x0 * 256,
          top: g.top - y0 * 256,
          width: g.width,
          height: g.height,
        })
        .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
        .png()
        .toBuffer();
      return { value, ttl: DAY };
    } catch {
      return { value: null, ttl: 60000 };
    }
  });
}
