import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const apply = process.argv.includes("--apply");
const source = JSON.parse(await readFile("private/staff-import.json", "utf8"));
if (!apply) {
  console.log("Import preview:", source.summary);
  console.log(
    "Review private/staff-import.json, then run npm run seed -- --apply.",
  );
  process.exit(0);
}
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key?.startsWith("sb_secret_"))
  throw Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...).");
async function api(path, method = "GET", body) {
  const r = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok)
    throw Error(
      `Supabase operation failed (${r.status}) at ${path.split("?")[0]}`,
    );
  return r.status === 204 ? null : r.json();
}
const users = [];
for (let page = 1; ; page++) {
  const data = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  users.push(...data.users);
  if (data.users.length < 1000) break;
}
const byEmail = new Map(users.map((u) => [u.email, u]));
const credentials = [];
for (const item of source.staff) {
  const phone = item.phones[0] || null;
  const email = item.email || (phone ? `${phone}@staff.araria.invalid` : null);
  if (!email) continue;
  let user = byEmail.get(email);
  if (!user) {
    const password = phone
      ? `Araria@${phone.slice(-4)}#26`
      : randomBytes(18).toString("base64url");
    user = await api("/auth/v1/admin/users", "POST", {
      email,
      password,
      email_confirm: true,
      user_metadata: { name: item.name, must_change_password: true },
    });
    byEmail.set(email, user);
    credentials.push({
      name: item.name,
      phone: phone || "",
      email: item.email || "",
      login: phone || email,
      password,
    });
  }
  const existing = await api(
    "/rest/v1/profiles?id=eq." + user.id + "&select=id",
  );
  if (!existing?.length)
    await api("/rest/v1/profiles", "POST", {
      id: user.id,
      name: item.name,
      phone,
      secondary_phones: item.phones.slice(1),
      email: item.email,
      login_email: email,
      assignments: item.assignments,
      role: "staff",
      active: true,
    });
}
const adminEmail = process.env.INITIAL_ADMIN_EMAIL || "sfc.aditya@gmail.com";
let admin = byEmail.get(adminEmail);
if (!admin) {
  if (
    !process.env.INITIAL_ADMIN_PASSWORD ||
    process.env.INITIAL_ADMIN_PASSWORD.length < 14
  )
    throw Error(
      "Set INITIAL_ADMIN_PASSWORD to a strong password of at least 14 characters.",
    );
  admin = await api("/auth/v1/admin/users", "POST", {
    email: adminEmail,
    password: process.env.INITIAL_ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { name: "Araria Administrator" },
  });
}
const currentAdmin = await api(
  "/rest/v1/profiles?id=eq." + admin.id + "&select=id,role",
);
if (currentAdmin?.length && currentAdmin[0].role !== "super_admin")
  throw Error(
    "Existing admin-email profile has another role. Review it manually before promoting.",
  );
if (!currentAdmin?.length)
  await api("/rest/v1/profiles", "POST", {
    id: admin.id,
    name: "Araria Administrator",
    phone: null,
    email: adminEmail,
    login_email: adminEmail,
    role: "super_admin",
    assignments: [],
    active: true,
  });
if (credentials.length) {
  const path = `private/credentials-${Date.now()}.csv`;
  const fields = ["name", "phone", "email", "login", "password"];
  await writeFile(
    path,
    "\ufeff" +
      [fields, ...credentials.map((c) => fields.map((f) => c[f]))]
        .map((row) =>
          row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
        )
        .join("\r\n"),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `${credentials.length} new accounts. One-time credentials saved privately to ${path}.`,
  );
} else console.log("No new accounts. Existing passwords were not changed.");
