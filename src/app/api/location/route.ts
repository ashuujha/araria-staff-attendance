import { identity, json, failure } from "../../../lib/server";
import {
  getLocationDetails,
  requestCoordinates,
} from "../../../lib/location-services";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    await identity(req);
    const { latitude, longitude } = requestCoordinates(req);
    const details = await getLocationDetails(latitude, longitude);
    return json({
      ...details,
      mapUrl: `/api/location-map?lat=${latitude}&lon=${longitude}`,
    });
  } catch (error) {
    return failure(error);
  }
}
