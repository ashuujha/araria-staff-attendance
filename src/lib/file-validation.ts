import { HttpError } from "./server";
import { fileKind } from "./security.mjs";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export function validateUploadBytes(bytes: Uint8Array, photo = false) {
  if (bytes.length < 20 || bytes.length >= MAX_UPLOAD_BYTES)
    throw new HttpError(400, "फ़ाइल 5 MB से छोटी रखें।");
  const kind = fileKind(bytes);
  if (kind !== "image/jpeg" && (photo || kind !== "application/pdf"))
    throw new HttpError(400, "JPEG फोटो या अवकाश PDF/JPEG दें।");
  if (kind === "application/pdf") {
    const text = Buffer.from(bytes).toString("latin1");
    // Decode escaped PDF names before checking known active content. This is
    // limited format validation, not a comprehensive malware scanner.
    const names = text.replace(/#([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (
      !text.startsWith("%PDF-") ||
      !/%%EOF\s*$/.test(text) ||
      /\/(JavaScript|JS|Launch|EmbeddedFile|Encrypt)\b/i.test(names)
    )
      throw new HttpError(400, "सादा, बिना पासवर्ड वाला PDF या JPEG दें।");
  }
  return kind as "image/jpeg" | "application/pdf";
}
export async function readBoundedUpload(response: Response) {
  if (Number(response.headers.get("content-length")) >= MAX_UPLOAD_BYTES)
    throw new HttpError(400, "फ़ाइल 5 MB से छोटी रखें।");
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(400, "अपलोड पूरा नहीं हुआ।");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size >= MAX_UPLOAD_BYTES)
        throw new HttpError(400, "फ़ाइल 5 MB से छोटी रखें।");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function sanitizeLeaveJpeg(bytes: Uint8Array) {
  const { default: sharp } = await import("sharp");
  try {
    return await sharp(bytes, { limitInputPixels: 20000000, failOn: "warning" })
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "JPEG फ़ाइल पढ़ी नहीं जा सकी।");
  }
}
export function validateWorkplacePhotoBytes(bytes: Uint8Array) {
  const kind = fileKind(bytes);
  if (
    bytes.length < 20 ||
    bytes.length >= MAX_UPLOAD_BYTES ||
    !["image/jpeg", "image/png"].includes(kind || "")
  )
    throw new HttpError(
      400,
      "JPEG/PNG फोटो चुनें, 5 MB से कम। / Choose a JPEG/PNG photo smaller than 5 MB.",
    );
  return kind as "image/jpeg" | "image/png";
}
export async function sanitizeWorkplacePhoto(bytes: Uint8Array) {
  const { default: sharp } = await import("sharp");
  validateWorkplacePhotoBytes(bytes);
  try {
    // Strip EXIF metadata; visible camera stamps are ordinary image pixels.
    const result = await sharp(bytes, {
      limitInputPixels: 20000000,
      failOn: "warning",
    })
      .rotate()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    validateUploadBytes(result, true);
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "फोटो पढ़ी नहीं जा सकी। सही JPEG/PNG चुनें। / Photo could not be read. Choose a valid JPEG/PNG.",
    );
  }
}
export function validateScannerConfiguration() {
  if (
    Boolean(process.env.UPLOAD_SCAN_URL) !==
    Boolean(process.env.UPLOAD_SCAN_TOKEN)
  )
    throw new HttpError(503, "फ़ाइल स्कैनर का सेटअप अधूरा है।");
}
export async function scanIfConfigured(bytes: Uint8Array, kind: string) {
  validateScannerConfiguration();
  if (!process.env.UPLOAD_SCAN_URL) return;
  try {
    const result = await fetch(process.env.UPLOAD_SCAN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.UPLOAD_SCAN_TOKEN}`,
        "Content-Type": kind,
      },
      body: new Uint8Array(bytes).buffer,
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok || (await result.json()).clean !== true)
      throw new Error("Scan failed");
  } catch {
    throw new HttpError(400, "फ़ाइल की सुरक्षा जाँच सफल नहीं हुई।");
  }
}
