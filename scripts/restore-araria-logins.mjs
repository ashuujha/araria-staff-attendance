// Restore existing Araria Auth profiles that uniquely match the current roster.
// Dry run by default. No passwords or attendance records are changed.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apply = process.argv.includes("--apply");
process.loadEnvFile(path.resolve("../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase configuration missing");

async function api(endpoint, method = "GET", body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(method === "PATCH" ? { Prefer: "return=representation" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(`${method} ${endpoint.split("?")[0]} failed: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const [araria] = await api("/rest/v1/blocks?code=eq.araria&select=id,name_en");
if (!araria) throw Error("Araria block not found");
const [roster, profiles] = await Promise.all([
  api("/rest/v1/staff_roster?deleted_at=is.null&select=id,block_id,name,phone,email,gender,assignments,active,linked_profile_id&limit=1000"),
  api("/rest/v1/profiles?role=eq.staff&select=id,block_id,name,phone,login_email,active,deleted_at&limit=1000"),
]);
if (roster.length >= 1000 || profiles.length >= 1000)
  throw Error("Directory exceeds the reviewed size limit");
const authUsers = [];
for (let page = 1; ; page++) {
  const result = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  authUsers.push(...result.users);
  if (result.users.length < 1000) break;
}
const authById = new Map(authUsers.map((user) => [user.id, user]));
const profilesByPhone = new Map();
for (const profile of profiles) {
  if (!profile.phone) continue;
  const matches = profilesByPhone.get(profile.phone) || [];
  matches.push(profile);
  profilesByPhone.set(profile.phone, matches);
}
const rosterByPhone = new Map();
for (const row of roster) {
  if (!row.phone) continue;
  rosterByPhone.set(row.phone, (rosterByPhone.get(row.phone) || 0) + 1);
}

const ready = [];
const review = [];
for (const row of roster.filter((item) => item.block_id === araria.id && item.active)) {
  const owners = profilesByPhone.get(row.phone) || [];
  const matches = owners.filter((owner) => owner.block_id === araria.id);
  const profile = matches[0];
  const authUser = profile && authById.get(profile.id);
  const conflictingActiveOwner = owners.some(
    (owner) => owner.id !== profile?.id && owner.active && !owner.deleted_at,
  );
  let reason = null;
  if (!row.phone || !/^[6-9]\d{9}$/.test(row.phone)) reason = "missing or invalid phone";
  else if (rosterByPhone.get(row.phone) !== 1) reason = "phone shared by roster entries";
  else if (matches.length !== 1) reason = "no unique existing Araria profile";
  else if (conflictingActiveOwner) reason = "another active account owns phone";
  else if (!authUser || authUser.email?.toLowerCase() !== profile.login_email?.toLowerCase())
    reason = "Auth account does not match profile";
  else if (row.linked_profile_id && row.linked_profile_id !== profile.id)
    reason = "roster is linked to another account";
  else if (
    !profile.active &&
    (!profile.deleted_at || !profile.deleted_at.startsWith("2026-11-10"))
  ) reason = "account was removed outside the Araria roster replacement";
  if (reason) review.push({ roster_id: row.id, name: row.name, phone: row.phone, reason });
  else ready.push({ row, profile });
}

console.log(JSON.stringify({
  current_araria_roster: ready.length + review.length,
  existing_accounts_to_restore: ready.filter(({ profile }) => !profile.active).length,
  already_active: ready.filter(({ profile }) => profile.active).length,
  roster_links_to_create: ready.filter(({ row }) => !row.linked_profile_id).length,
  needs_review: review.length,
  review_reasons: Object.fromEntries(
    [...new Set(review.map((item) => item.reason))].map((reason) => [
      reason, review.filter((item) => item.reason === reason).length,
    ]),
  ),
  passwords_changed: 0,
  attendance_records_changed: 0,
}, null, 2));
if (!apply) process.exit(0);

// A private snapshot gives an exact manual rollback path for these profile fields.
const privateDir = path.resolve("private");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const snapshotPath = path.join(privateDir, `araria-login-restore-${Date.now()}.json`);
await writeFile(snapshotPath, JSON.stringify(ready, null, 2), { mode: 0o600 });
const reviewPath = path.join(privateDir, "araria-login-needs-review.json");
await writeFile(reviewPath, JSON.stringify(review, null, 2), { mode: 0o600 });
let restored = 0;
let linked = 0;
for (const { row, profile } of ready) {
  if (!profile.active) {
    const updated = await api(
      `/rest/v1/profiles?id=eq.${profile.id}&active=eq.false&deleted_at=not.is.null`,
      "PATCH",
      {
        name: row.name,
        email: row.email,
        gender: row.gender,
        assignments: row.assignments,
        block: araria.name_en,
        active: true,
        deleted_at: null,
      },
    );
    if (updated.length !== 1) throw Error("Profile changed during restoration; stopped");
    restored++;
  }
  if (!row.linked_profile_id) {
    const updated = await api(
      `/rest/v1/staff_roster?id=eq.${row.id}&linked_profile_id=is.null`,
      "PATCH",
      { linked_profile_id: profile.id },
    );
    if (updated.length !== 1) throw Error("Roster changed during restoration; stopped");
    linked++;
  }
}
const dpro = await api(
  "/rest/v1/profiles?role=eq.dpro&active=eq.true&deleted_at=is.null&select=id&limit=2",
);
if (dpro.length === 1 && (restored || linked)) {
  await api("/rest/v1/audit_logs", "POST", {
    actor_id: dpro[0].id,
    action: "restore_araria_roster_logins",
    target_id: araria.id,
    reason: "Restore existing Auth accounts matching the current Araria roster",
    details: { restored, linked, needs_review: review.length },
    block_id: araria.id,
  });
}
console.log(JSON.stringify({ restored, linked, needs_review: review.length, snapshot: snapshotPath, review_file: reviewPath }));
