import sharp, { type OverlayOptions } from "sharp";
import { HttpError } from "./server";
type LocationStamp = { address: string | null; map: Buffer | null };
async function renderPhoto(
  bytes: Uint8Array,
  latitude: number,
  longitude: number,
  accuracy: number,
  challenge: string,
  workplace = "Araria attendance",
  savedAt = new Date(),
  location?: LocationStamp,
) {
  const image = sharp(bytes, { limitInputPixels: 4000000, failOn: "warning" });
  const m = await image.metadata();
  if (!m.width || !m.height || m.width < 320 || m.height < 240)
    throw new HttpError(400, "कैमरा फोटो बहुत छोटी है।");
  const { data } = await sharp(bytes)
    .extract({
      left: 0,
      top: 0,
      width: m.width,
      height: Math.floor(m.height * 0.84),
    })
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  const timestamp = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(savedAt);
  // Keep the complete image and add a footer below it. This is server save time.
  const normalized = await sharp(bytes, {
    limitInputPixels: 4000000,
    failOn: "warning",
  })
    .rotate()
    .resize({
      width: 1200,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer({ resolveWithObject: true });
  const width = normalized.info.width,
    height = normalized.info.height;
  const font = Math.max(14, Math.round(width / 40));
  const lineHeight = Math.round(font * 1.5),
    padding = Math.round(font * 0.9);
  const sideMap = Boolean(location?.map) && width >= 760;
  const mapWidth = location?.map
    ? Math.round(sideMap ? width * 0.28 : Math.min(256, width - padding * 2))
    : 0;
  const mapHeight = Math.round((mapWidth * 180) / 256);
  const textLeft = sideMap ? mapWidth + padding * 2 : padding;
  const textTop = location?.map && !sideMap ? mapHeight + padding : 0;
  const maxChars = Math.max(
    18,
    Math.floor((width - textLeft - padding) / (font * 0.64)),
  );
  const label = workplace.replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
  const wrap = (text: string) =>
    Array.from({ length: Math.ceil(text.length / maxChars) }, (_, i) =>
      text.slice(i * maxChars, (i + 1) * maxChars),
    );
  const lines = [
    "ATTENDANCE | DEVICE LOCATION",
    ...wrap(
      "Nearby mapped address: " +
        (location?.address || "Unavailable; see coordinates"),
    ),
    ...wrap("Assigned workplace: " + label),
    ...wrap(`Lat ${latitude.toFixed(6)}° | Long ${longitude.toFixed(6)}°`),
    ...wrap(`Device-reported accuracy: ±${Math.round(accuracy)} m`),
    ...wrap(timestamp + " IST (UTC +05:30)"),
    "Server save time",
    ...(location?.address || location?.map
      ? ["© OpenStreetMap contributors"]
      : []),
  ];
  const footerHeight = Math.max(
    padding * 2 + textTop + lines.length * lineHeight,
    mapHeight + padding * 2,
  );
  const watermark = `<svg width="${width}" height="${footerHeight}"><rect width="100%" height="100%" fill="#16251d"/>${lines.map((line, i) => `<text x="${textLeft}" y="${textTop + padding + font + i * lineHeight}" font-size="${font}" fill="white" font-family="sans-serif">${escape(line)}</text>`).join("")}</svg>`;
  const composites: OverlayOptions[] = [
    { input: Buffer.from(watermark), top: height, left: 0 },
  ];
  if (location?.map)
    composites.push({
      input: await sharp(location.map)
        .resize(mapWidth, mapHeight)
        .png()
        .toBuffer(),
      top: height + padding,
      left: padding,
    });
  const processed = await sharp(normalized.data)
    .extend({ bottom: footerHeight, background: "#16251d" })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
  return { bytes: processed, perceptualHash: bits };
}

export async function processPhoto(
  bytes: Uint8Array,
  latitude: number,
  longitude: number,
  accuracy: number,
  challenge: string,
  workplace = "Araria attendance",
  savedAt = new Date(),
  location?: LocationStamp,
) {
  try {
    return await renderPhoto(
      bytes,
      latitude,
      longitude,
      accuracy,
      challenge,
      workplace,
      savedAt,
      location,
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "कैमरा JPEG फोटो पढ़ी नहीं जा सकी। फिर फोटो लें।");
  }
}
