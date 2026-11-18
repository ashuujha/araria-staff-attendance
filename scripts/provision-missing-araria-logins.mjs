// Create only unambiguous Araria roster logins. Dry run unless --apply is passed.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(path.resolve("../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase configuration missing");
const apply = process.argv.includes("--apply");
const outputDir = path.resolve("private");
const journalPath = path.join(outputDir, "new-araria-login-credentials.json");
async function api(endpoint, method = "GET", body, prefer) {
  const response = await fetch(base + endpoint, {
    method,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      `${method} ${endpoint.split("?")[0]} returned HTTP ${response.status}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const [blocks, roster, profiles] = await Promise.all([
  api("/rest/v1/blocks?code=eq.araria&select=id,name_en"),
  api(
    "/rest/v1/staff_roster?select=id,source_key,name,phone,email,gender,assignments,block_id,active,deleted_at,linked_profile_id&limit=1000",
  ),
  api(
    "/rest/v1/profiles?select=id,name,phone,login_email,role,block_id,active,deleted_at&limit=1000",
  ),
]);
if (blocks.length !== 1 || roster.length >= 1000 || profiles.length >= 1000)
  throw Error("Block or row count requires review");
const araria = blocks[0];
const activeRoster = roster.filter((row) => row.active && !row.deleted_at);
const counts = new Map();
for (const row of activeRoster)
  if (row.phone) counts.set(row.phone, (counts.get(row.phone) || 0) + 1);
const profilePhones = new Set(profiles.map((row) => row.phone).filter(Boolean));
const candidates = activeRoster.filter(
  (row) =>
    row.block_id === araria.id &&
    !row.linked_profile_id &&
    /^[6-9]\d{9}$/.test(row.phone || "") &&
    counts.get(row.phone) === 1 &&
    !profilePhones.has(row.phone) &&
    row.assignments?.some(
      (assignment) =>
        assignment.block_id === araria.id &&
        assignment.department === "पंचायती राज विभाग",
    ),
);
console.log(
  JSON.stringify({ eligible_araria_accounts: candidates.length, apply }),
);
if (!apply) process.exit(0);

await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
let journal = [];
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!Array.isArray(journal)) throw Error("Credential journal malformed");
const saved = new Map(journal.map((entry) => [entry.roster_id, entry]));
async function saveJournal() {
  await writeFile(journalPath, JSON.stringify(journal, null, 2), {
    mode: 0o600,
  });
  await chmod(journalPath, 0o600);
}
let created = 0;
for (const row of candidates) {
  const loginEmail = `${row.phone}@staff.araria.invalid`;
  const users = await api("/auth/v1/admin/users?page=1&per_page=1000");
  let user = users.users.find(
    (candidate) => candidate.email?.toLowerCase() === loginEmail,
  );
  const oldProfile = user && profiles.find((profile) => profile.id === user.id);
  if (
    user &&
    (user.user_metadata?.name !== row.name ||
      (oldProfile &&
        (oldProfile.role !== "staff" ||
          oldProfile.name !== row.name ||
          oldProfile.block_id !== araria.id ||
          oldProfile.login_email !== loginEmail ||
          oldProfile.active ||
          !oldProfile.deleted_at ||
          activeRoster.some((entry) => entry.phone === oldProfile.phone))))
  )
    throw Error("Existing Auth account does not match roster; review required");
  if (!user) {
    let entry = saved.get(row.id);
    if (!entry) {
      entry = {
        roster_id: row.id,
        name: row.name,
        login_id: row.phone,
        password: randomBytes(18).toString("base64url"),
        created_at: new Date().toISOString(),
      };
      journal.push(entry);
      saved.set(row.id, entry);
      await saveJournal();
    }
    user = await api("/auth/v1/admin/users", "POST", {
      email: loginEmail,
      password: entry.password,
      email_confirm: true,
      user_metadata: {
        name: row.name,
        roster_source_key: row.source_key || row.id,
        provisioned_by: "araria_roster_repair",
      },
    });
  }
  const newProfile = {
    id: user.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    login_email: loginEmail,
    block: araria.name_en,
    block_id: araria.id,
    assignments: row.assignments,
    role: "staff",
    active: true,
    gender: row.gender,
    deleted_at: null,
  };
  if (oldProfile)
    await api(
      `/rest/v1/profiles?id=eq.${user.id}`,
      "PATCH",
      newProfile,
      "return=minimal",
    );
  else await api("/rest/v1/profiles", "POST", newProfile, "return=minimal");
  await api(
    `/rest/v1/staff_roster?id=eq.${row.id}&linked_profile_id=is.null`,
    "PATCH",
    { linked_profile_id: user.id },
    "return=minimal",
  );
  created++;
}
console.log(JSON.stringify({ created, credentials_file: journalPath }));
