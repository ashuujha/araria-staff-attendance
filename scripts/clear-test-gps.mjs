import { readFile, writeFile, chmod, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const pendingFile = "private/test-gps-cleanup-pending.json";
export async function clearTestGps({
  url,
  key,
  adminEmail,
  apply = false,
  cutoff = new Date().toISOString(),
  pending = [],
  savePending = async () => {},
}) {
  if (!url || !key?.startsWith("sb_secret_"))
    throw Error("Supabase server configuration is missing.");
  async function api(path, method = "GET", body, extraHeaders = {}) {
    const response = await fetch(url + path, {
      method,
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(
        `Cleanup failed (HTTP ${response.status}) at ${path.split("?")[0]}. Pending photo deletions can be retried with the same command.`,
      );
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  const records = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await api(
      `/rest/v1/attendance?created_at=lte.${encodeURIComponent(cutoff)}&select=id,version,photo_path,out_photo_path,latitude,longitude,accuracy,out_location,photo_hash,out_photo_hash,leave_path&order=id&offset=${offset}&limit=1000`,
    );
    records.push(...rows);
    if (rows.length < 1000) break;
  }
  const targets = records.filter((r) =>
    [
      "photo_path",
      "out_photo_path",
      "latitude",
      "longitude",
      "accuracy",
      "out_location",
      "photo_hash",
      "out_photo_hash",
    ].some((field) => r[field] != null),
  );
  const paths = new Set([
    ...pending,
    ...targets.flatMap((r) => [r.photo_path, r.out_photo_path]).filter(Boolean),
  ]);
  for (const path of paths)
    if (!/^[-a-zA-Z0-9/_.]+$/.test(path) || path.includes(".."))
      throw Error("Unexpected photo path. Cleanup stopped.");
  // A shared leave document must never be deleted through the photo cleanup.
  for (const path of paths) {
    const leaveReferences = await api(
      "/rest/v1/attendance?leave_path=eq." +
        encodeURIComponent(path) +
        "&select=id&limit=1",
    );
    if (leaveReferences.length)
      throw Error(
        "A photo path is also referenced as a leave document. Cleanup stopped.",
      );
  }
  const summary = {
    attendanceRecords: targets.length,
    gpsPhotos: paths.size,
    cutoff,
  };
  if (!apply) return summary;
  const admins = await api(
    "/rest/v1/profiles?login_email=eq." +
      encodeURIComponent(adminEmail) +
      "&role=eq.dpro&active=eq.true&deleted_at=is.null&select=id",
  );
  if (admins.length !== 1)
    throw Error("Exactly one active administrator is required.");
  const pendingPaths = new Set(pending);
  let cleared = 0;
  for (const row of targets) {
    const rowPaths = [row.photo_path, row.out_photo_path].filter(Boolean);
    // Retain only object names for retry after a network interruption, never GPS
    // coordinates or image bytes. Do not back up the data being erased.
    for (const path of rowPaths) pendingPaths.add(path);
    await savePending([...pendingPaths]);
    const updated = await api(
      `/rest/v1/attendance?id=eq.${row.id}&version=eq.${row.version}`,
      "PATCH",
      {
        latitude: null,
        longitude: null,
        accuracy: null,
        out_location: null,
        photo_path: null,
        out_photo_path: null,
        photo_hash: null,
        out_photo_hash: null,
        version: row.version + 1,
      },
      { Prefer: "return=representation" },
    );
    if (updated.length !== 1)
      throw Error(
        "An attendance record changed during cleanup. Retry to read its current version.",
      );
    cleared++;
  }
  for (const path of [...pendingPaths]) {
    // Recheck references, including records created during cleanup, before
    // deleting the actual private storage object.
    const referenced = await api(
      "/rest/v1/attendance?or=" +
        encodeURIComponent(
          `(photo_path.eq.${path},out_photo_path.eq.${path},leave_path.eq.${path})`,
        ) +
        "&select=id&limit=1",
    );
    if (referenced.length)
      throw Error(
        "A pending photo is still referenced. Cleanup stopped; retry after reviewing the record.",
      );
    await api("/storage/v1/object/attendance-private", "DELETE", {
      prefixes: [path],
    });
    await api(
      "/rest/v1/pending_uploads?path=eq." + encodeURIComponent(path),
      "DELETE",
    );
    pendingPaths.delete(path);
    await savePending([...pendingPaths]);
  }
  await api("/rest/v1/audit_logs", "POST", {
    actor_id: admins[0].id,
    action: "clear_test_gps",
    target_id: "attendance",
    reason:
      "Owner requested removal of GPS photos and locations from all existing test attendance records",
    details: { records_cleared: cleared, photos_deleted: paths.size, cutoff },
  });
  return { ...summary, cleared, photosDeleted: paths.size };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    let pending = [];
    try {
      pending = JSON.parse(await readFile(pendingFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const apply = process.argv.includes("--apply");
    const result = await clearTestGps({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SECRET_KEY,
      adminEmail: process.env.INITIAL_ADMIN_EMAIL || "sfc.aditya@gmail.com",
      apply,
      pending,
      savePending: async (paths) => {
        await writeFile(pendingFile, JSON.stringify(paths), { mode: 0o600 });
        await chmod(pendingFile, 0o600);
      },
    });
    if (apply) {
      await unlink(pendingFile).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      console.log("GPS test data cleared:", result);
    } else console.log("Preview only; no changes made:", result);
  } catch (error) {
    console.error(
      error.cause?.code
        ? "Connection failed: " + error.cause.code
        : error.message,
    );
    process.exitCode = 1;
  }
}
