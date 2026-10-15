import { identity, failure, HttpError } from "../../../lib/server";
import {
  getMapThumbnail,
  requestCoordinates,
} from "../../../lib/location-services";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    await identity(req);
    const { latitude, longitude } = requestCoordinates(req);
    const image = await getMapThumbnail(latitude, longitude);
    if (!image)
      throw new HttpError(
        503,
        "नक्शा अभी उपलब्ध नहीं है। GPS निर्देशांक सुरक्षित रहेंगे।",
      );
    return new Response(new Uint8Array(image).buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
