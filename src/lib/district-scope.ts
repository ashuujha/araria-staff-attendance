import type { Profile } from "./types";
import { HttpError } from "./server";
import { PANCHAYATI_RAJ_DEPARTMENT } from "./district";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the only block an admin request may read, or null for all district blocks. */
export function requestedBlock(
  profile: Profile,
  supplied: unknown,
): string | null {
  const value = supplied == null || supplied === "" ? null : String(supplied);
  if (value !== null && !uuid.test(value))
    throw new HttpError(400, "Invalid block.");
  if (profile.role === "bpro") {
    if (value && value !== profile.block_id)
      throw new HttpError(403, "This block is outside your office.");
    return profile.block_id;
  }
  if (profile.role === "dpro") return value;
  throw new HttpError(403, "Administrator access required.");
}

export function ownBlock(profile: Profile, supplied: unknown): string {
  if (profile.role === "dpro") {
    if (typeof supplied !== "string" || !uuid.test(supplied))
      throw new HttpError(400, "Choose a block.");
    return supplied;
  }
  return requestedBlock(profile, supplied)!;
}

export function districtAssignments(input: unknown, blockId: string) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 31)
    throw new HttpError(400, "Choose at least one assigned workspace.");
  return input.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.panchayat !== "string" ||
      typeof value.position !== "string" ||
      value.panchayat.trim().length < 2 ||
      value.position.trim().length < 2 ||
      value.panchayat.length > 200 ||
      value.position.length > 200 ||
      (value.block_id && value.block_id !== blockId)
    )
      throw new HttpError(400, "Invalid workspace assignment or block.");
    return {
      panchayat: value.panchayat.trim(),
      position: value.position.trim(),
      department: PANCHAYATI_RAJ_DEPARTMENT,
      block_id: blockId,
    };
  });
}
