import { failure, identity, json } from "../../../lib/server";
import {
  getLocationDetails,
  getMapThumbnail,
  requestCoordinates,
} from "../../../lib/location-services";

export const runtime = "nodejs";

/** One authenticated request supplies the camera's optional place/map label. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const { latitude, longitude } = requestCoordinates(req);
    const [details, map] = await Promise.all([
      getLocationDetails(latitude, longitude),
      getMapThumbnail(latitude, longitude),
    ]);
    return json({
      place: details.place,
      address: details.address,
      map: map ? `data:image/png;base64,${map.toString("base64")}` : null,
      attribution: details.attribution,
    });
  } catch (error) {
    return failure(error);
  }
}
