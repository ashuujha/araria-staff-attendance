import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export async function resetAdminPassword({
  url,
  key,
  publishableKey,
  email,
  password,
}) {
  if (
    !url ||
    !key?.startsWith("sb_secret_") ||
    !publishableKey ||
    !email ||
    !password ||
    password.length < 14
  )
    throw Error(
      "Set Supabase keys, admin email and INITIAL_ADMIN_PASSWORD (at least 14 characters).",
    );
  async function api(path, method = "GET", body, apiKey = key) {
    const response = await fetch(url + path, {
      method,
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        `Admin reset failed (HTTP ${response.status}) at ${path.split("?")[0]}. Rerun after correcting the connection or configuration.`,
      );
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  const profiles = await api(
    "/rest/v1/profiles?login_email=eq." +
      encodeURIComponent(email) +
      "&role=eq.super_admin&active=eq.true&deleted_at=is.null&select=id",
  );
  if (profiles.length !== 1)
    throw Error(
      "Exactly one matching active administrator account is required.",
    );
  const id = profiles[0].id;
  await api("/auth/v1/admin/users/" + id, "PUT", { password });
  // Clear only this administrator's old origin-bound cookie, preserving staff binding.
  await api("/rest/v1/profiles?id=eq." + id + "&role=eq.super_admin", "PATCH", {
    device_hash: null,
  });
  const session = await api(
    "/auth/v1/token?grant_type=password",
    "POST",
    { email, password },
    publishableKey,
  );
  if (session.user?.id !== id || !session.access_token)
    throw Error("The updated administrator login could not be verified.");
  await api("/rest/v1/audit_logs", "POST", {
    actor_id: id,
    action: "reset_admin_password",
    target_id: id,
    reason:
      "User-requested administrator password and localhost-to-production login reset",
    details: { password_changed: true, device_reset: true },
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await resetAdminPassword({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SECRET_KEY,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      email: process.env.INITIAL_ADMIN_EMAIL || "sfc.aditya@gmail.com",
      password: process.env.INITIAL_ADMIN_PASSWORD,
    });
    console.log(
      "Administrator password updated and verified. Select Admin and sign in on the deployed website.",
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
