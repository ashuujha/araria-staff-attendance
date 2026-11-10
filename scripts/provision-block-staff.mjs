// Provision non-Araria roster staff who have a unique valid phone number.
// Credentials are written outside the Git repository, never to stdout.
import ExcelJS from "exceljs";
import { readFile, writeFile, mkdir, chmod, rename } from "node:fs/promises";
import path from "node:path";

const apply = process.argv.includes("--apply");
const limitOption = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = limitOption ? Number(limitOption.slice("--limit=".length)) : Infinity;
if (limitOption && (!Number.isSafeInteger(limit) || limit < 1))
  throw Error("--limit must be a positive integer");
process.loadEnvFile(path.resolve("../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase configuration missing");
const outputDir = path.resolve("../STAFF CREDENTIALS");
const journalPath = path.join(outputDir, ".provision-journal.json");
let journal = [];
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
  if (!Array.isArray(journal)) throw Error("Invalid credential journal");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const journalIds = new Set(journal.map((row) => row.roster_id));
const blocksWanted = [
  "bhargama", "forbesganj", "jokihat", "kursakanta",
  "narpatganj", "palasi", "raniganj", "sikti",
];
const validPhone = (phone) => /^[6-9]\d{9}$/.test(phone || "");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(endpoint, method = "GET", body, prefer) {
  for (let attempt = 0; attempt < 5; attempt++) {
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
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await wait(750 * 2 ** attempt);
      continue;
    }
    if (!response.ok)
      throw Error(`Supabase ${method} ${endpoint.split("?")[0]} returned HTTP ${response.status}`);
    const content = await response.text();
    return content ? JSON.parse(content) : null;
  }
}

const blocks = await api("/rest/v1/blocks?select=id,code,name_en&limit=20");
const byBlock = new Map(blocks.map((block) => [block.id, block]));
if (blocksWanted.some((code) => !blocks.some((block) => block.code === code)))
  throw Error("One or more district blocks are missing");
const roster = await api(
  "/rest/v1/staff_roster?select=id,block_id,name,phone,email,gender,assignments,active,deleted_at,linked_profile_id,source_key&limit=1000",
);
if (roster.length >= 1000) throw Error("Roster exceeds review limit");
const profiles = await api(
  "/rest/v1/profiles?select=id,role,block_id,phone,login_email,active,deleted_at&limit=1000",
);
if (profiles.length >= 1000) throw Error("Profiles exceed review limit");
const users = [];
for (let page = 1; ; page++) {
  const result = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  users.push(...result.users);
  if (result.users.length < 1000) break;
}
const userByEmail = new Map(users.map((user) => [user.email?.toLowerCase(), user]));
const activeRoster = roster.filter((row) => row.active && !row.deleted_at);
const targets = activeRoster.filter(
  (row) => blocksWanted.includes(byBlock.get(row.block_id)?.code) && !row.linked_profile_id,
);
const phoneOwners = new Map();
for (const row of activeRoster) {
  if (!validPhone(row.phone)) continue;
  phoneOwners.set(row.phone, (phoneOwners.get(row.phone) || 0) + 1);
}
const profilePhones = new Set(profiles.map((profile) => profile.phone).filter(Boolean));
const review = [];
const ready = [];
for (const row of targets) {
  const block = byBlock.get(row.block_id);
  let reason = null;
  if (!validPhone(row.phone)) reason = "Missing or invalid mobile number";
  else if (phoneOwners.get(row.phone) > 1) reason = "Mobile number appears in multiple directory entries";
  else if (profilePhones.has(row.phone) && !journalIds.has(row.id))
    reason = "Mobile number is already assigned to an existing account";
  else {
    const email = `${row.phone}@staff.araria.invalid`;
    const existing = userByEmail.get(email);
    if (existing && existing.user_metadata?.roster_source_key !== (row.source_key || row.id))
      reason = "Login email already belongs to another Auth account";
  }
  if (reason) review.push({ ...row, block: block.name_en, reason });
  else ready.push({ ...row, block: block.name_en, code: block.code });
}
console.log(JSON.stringify({
  active_unlinked_non_araria_roster: targets.length,
  eligible_accounts: ready.length,
  needs_review: review.length,
  review_reasons: Object.fromEntries(
    [...new Set(review.map((row) => row.reason))].map((reason) => [reason, review.filter((row) => row.reason === reason).length]),
  ),
  eligible_by_block: Object.fromEntries(blocksWanted.map((code) => [code, ready.filter((row) => row.code === code).length])),
  araria_accounts_changed: 0,
}, null, 2));
if (!apply) process.exit(0);

await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
let journalWrite = Promise.resolve();
function saveJournal() {
  journalWrite = journalWrite.then(async () => {
    const temporary = journalPath + ".tmp";
    await writeFile(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, journalPath);
  });
  return journalWrite;
}

let created = 0;
let failed = 0;
let consecutiveFailures = 0;
async function provision(row) {
  try {
    const loginEmail = `${row.phone}@staff.araria.invalid`;
    const password = `${row.block}@${row.phone.slice(-4)}#26`;
    let user = userByEmail.get(loginEmail);
    if (!user) {
      user = await api("/auth/v1/admin/users", "POST", {
        email: loginEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: row.name,
          roster_source_key: row.source_key || row.id,
          provisioned_by: "district_roster",
        },
      });
      userByEmail.set(loginEmail, user);
    }
    if (user.user_metadata?.roster_source_key !== (row.source_key || row.id))
      throw Error("Auth account ownership changed");
    const existingProfile = await api(`/rest/v1/profiles?id=eq.${user.id}&select=id,phone,block_id`);
    if (existingProfile.length &&
        (existingProfile[0].phone !== row.phone || existingProfile[0].block_id !== row.block_id))
      throw Error("Existing profile does not match roster");
    if (!existingProfile.length) {
      await api("/rest/v1/profiles", "POST", {
        id: user.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        login_email: loginEmail,
        block: row.block,
        block_id: row.block_id,
        assignments: row.assignments,
        role: "staff",
        active: true,
        gender: row.gender,
      }, "return=minimal");
    }
    if (!journalIds.has(row.id)) {
      journal.push({
        roster_id: row.id, profile_id: user.id, block: row.block, code: row.code,
        name: row.name, phone: row.phone, login_id: row.phone, password,
        assignments: row.assignments,
      });
      journalIds.add(row.id);
      await saveJournal();
    }
    const linked = await api(
      `/rest/v1/staff_roster?id=eq.${row.id}&linked_profile_id=is.null&select=id`,
      "PATCH", { linked_profile_id: user.id }, "return=representation",
    );
    if (linked.length !== 1) {
      const current = await api(`/rest/v1/staff_roster?id=eq.${row.id}&select=linked_profile_id`);
      if (current[0]?.linked_profile_id !== user.id) throw Error("Roster link changed");
    }
    created++;
    consecutiveFailures = 0;
    if (created % 25 === 0) console.log(`Provisioned ${created}/${ready.length}`);
  } catch (error) {
    failed++;
    consecutiveFailures++;
    review.push({ ...row, reason: `Provisioning failed: ${error.message}` });
    if (consecutiveFailures >= 5) {
      console.error("Stopped after five consecutive provisioning errors:", error.message);
      return;
    }
  }
}
const queue = ready.slice(0, limit);
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < queue.length && consecutiveFailures < 5) {
    const row = queue[cursor++];
    await provision(row);
  }
}));
await journalWrite;

async function writeWorkbook(filename, title, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF245D88" } };
  for (const row of rows) {
    const added = sheet.addRow(row);
    if (filename === "NEEDS_REVIEW.xlsx" && row.reason?.startsWith("Missing"))
      added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2B3" } };
  }
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + columns.length)}${Math.max(1, sheet.rowCount)}` };
  const destination = path.join(outputDir, filename);
  const temporary = destination + ".tmp";
  await workbook.xlsx.writeFile(temporary);
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
}
const credentialColumns = [
  ["Staff name", "name", 30], ["Mobile number", "phone", 18],
  ["Login ID", "login_id", 18], ["Password", "password", 27],
  ["Block", "block", 18], ["Panchayat / workplace", "panchayats", 42],
  ["Position", "positions", 36], ["Website", "website", 49],
];
for (const code of blocksWanted) {
  const entries = journal.filter((row) => row.code === code).sort((a, b) => a.name.localeCompare(b.name));
  await writeWorkbook(`BPRO_${code.toUpperCase()}_STAFF_CREDENTIALS.xlsx`, "Staff Logins", credentialColumns,
    entries.map((row) => ({
      name: row.name, phone: row.phone, login_id: row.login_id,
      password: row.password, block: row.block,
      panchayats: row.assignments.map((assignment) => assignment.panchayat).join("; "),
      positions: row.assignments.map((assignment) => assignment.position).join("; "),
      website: "https://araria-staff-attendance.vercel.app/",
    })));
}
await writeWorkbook("NEEDS_REVIEW.xlsx", "Needs Review", [
  ["Block", "block", 18], ["Staff name", "name", 30],
  ["Mobile number", "phone", 18], ["Reason", "reason", 64],
], review.map((row) => ({ block: row.block, name: row.name, phone: row.phone || "", reason: row.reason })));
const dpros = await api(
  "/rest/v1/profiles?role=eq.dpro&active=eq.true&deleted_at=is.null&select=id&limit=2",
);
if (dpros.length !== 1) throw Error("Expected exactly one active DPRO for provisioning audit");
const audited = await api(
  "/rest/v1/audit_logs?action=eq.provision_staff_account&select=target_id&limit=1000",
);
if (audited.length >= 1000) throw Error("Provisioning audit exceeds review limit");
const auditedIds = new Set(audited.map((entry) => entry.target_id));
const newAuditRows = journal.filter((row) => !auditedIds.has(row.profile_id)).map((row) => ({
  actor_id: dpros[0].id,
  action: "provision_staff_account",
  target_id: row.profile_id,
  reason: "Staff account created from block roster",
  block_id: blocks.find((block) => block.code === row.code).id,
}));
for (let index = 0; index < newAuditRows.length; index += 100)
  await api("/rest/v1/audit_logs", "POST", newAuditRows.slice(index, index + 100), "return=minimal");
console.log(JSON.stringify({ provisioned_this_run: created, failed, credential_files: blocksWanted.length,
  credentials_saved: journal.length, needs_review: review.length, audited_accounts: newAuditRows.length,
  folder: outputDir,
  araria_accounts_changed: 0 }, null, 2));
if (failed) process.exitCode = 1;
