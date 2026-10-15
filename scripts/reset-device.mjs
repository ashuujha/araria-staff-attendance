import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export async function resetStaffDevice(phone, { url, key, adminEmail }) {
  if (!/^[6-9]\d{9}$/.test(phone))
    throw Error("Enter one valid 10-digit staff phone number.");
  if (!url || !key?.startsWith("sb_secret_"))
    throw Error("Supabase server configuration is missing.");
  async function api(path, method = "GET", body) {
    const response = await fetch(url + path, {
      method,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        `Device reset failed (HTTP ${response.status}); check database setup and permissions.`,
      );
    return response.status === 204 ? null : response.json();
  }
  const admins = await api(
    "/rest/v1/profiles?email=eq." +
      encodeURIComponent(adminEmail) +
      "&role=eq.super_admin&active=eq.true&deleted_at=is.null&select=id",
  );
  const staff = await api(
    "/rest/v1/profiles?phone=eq." +
      phone +
      "&role=eq.staff&active=eq.true&deleted_at=is.null&select=id",
  );
  if (admins.length !== 1 || staff.length !== 1)
    throw Error(
      "Exactly one active administrator and matching staff account are required.",
    );
  await api("/rest/v1/rpc/manage_staff", "POST", {
    actor_id: admins[0].id,
    target_id: staff[0].id,
    changes: { reset_device: true },
    reason_text:
      "Authorized login device reset when moving from localhost to the production portal",
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await resetStaffDevice(process.argv[2] || "", {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SECRET_KEY,
      adminEmail: process.env.INITIAL_ADMIN_EMAIL || "sfc.aditya@gmail.com",
    });
    console.log(
      "Staff login device reset. Sign in on the production website now.",
    );
  } catch (error) {
    console.error(
      error.cause?.code
        ? "Connection failed: " + error.cause.code
        : error.message,
    );
    process.exitCode = 1;
  }
}
