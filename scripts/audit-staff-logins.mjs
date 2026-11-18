// Read-only audit of roster, profile and Supabase Auth links. No password guesses.
import ExcelJS from "exceljs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(path.resolve("../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase configuration missing");

async function read(endpoint) {
  const response = await fetch(base + endpoint, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(`${endpoint.split("?")[0]} returned HTTP ${response.status}`);
  return response.json();
}
async function all(table, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await read(
      `/rest/v1/${table}?select=${select}&order=id.asc&limit=1000&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
async function authUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const result = await read(
      `/auth/v1/admin/users?page=${page}&per_page=1000`,
    );
    users.push(...result.users);
    if (result.users.length < 1000) return users;
  }
}

const [blocks, roster, profiles, users] = await Promise.all([
  all("blocks", "id,code,name_en"),
  all(
    "staff_roster",
    "id,name,phone,block_id,active,deleted_at,linked_profile_id",
  ),
  all(
    "profiles",
    "id,name,phone,login_email,role,block_id,active,deleted_at,assignments",
  ),
  authUsers(),
]);
const blockById = new Map(blocks.map((row) => [row.id, row]));
const profileById = new Map(profiles.map((row) => [row.id, row]));
const userById = new Map(users.map((row) => [row.id, row]));
const activeRoster = roster.filter((row) => row.active && !row.deleted_at);
const rosterByPhone = new Map();
for (const row of activeRoster) {
  if (!row.phone) continue;
  rosterByPhone.set(row.phone, (rosterByPhone.get(row.phone) || 0) + 1);
}
const profilesByPhone = new Map();
for (const row of profiles) {
  if (!row.phone) continue;
  const group = profilesByPhone.get(row.phone) || [];
  group.push(row);
  profilesByPhone.set(row.phone, group);
}

function statusFor(row) {
  if (!row.active || row.deleted_at)
    return ["Not active", "Directory entry archived"];
  if (!/^[6-9]\d{9}$/.test(row.phone || ""))
    return ["Needs review", "Missing or invalid mobile number"];
  if (rosterByPhone.get(row.phone) !== 1)
    return ["Needs review", "Mobile number is shared by directory entries"];
  const matches = (profilesByPhone.get(row.phone) || []).filter(
    (profile) => profile.role === "staff" && profile.block_id === row.block_id,
  );
  const linked =
    row.linked_profile_id && profileById.get(row.linked_profile_id);
  const profile = linked || (matches.length === 1 ? matches[0] : null);
  if (!profile)
    return [
      "Needs review",
      matches.length > 1
        ? "Multiple matching profiles"
        : "No staff login profile",
    ];
  if (
    profile.role !== "staff" ||
    profile.block_id !== row.block_id ||
    profile.phone !== row.phone
  )
    return ["Needs review", "Linked profile differs from roster"];
  if (!profile.active || profile.deleted_at)
    return ["Needs review", "Staff login profile is inactive"];
  const activeOwners = (profilesByPhone.get(row.phone) || []).filter(
    (owner) => owner.role === "staff" && owner.active && !owner.deleted_at,
  );
  if (activeOwners.length !== 1)
    return ["Needs review", "Mobile number has multiple active staff accounts"];
  const user = userById.get(profile.id);
  if (
    !user ||
    !profile.login_email ||
    user.email?.toLowerCase() !== profile.login_email.toLowerCase()
  )
    return ["Needs review", "Supabase Auth user or email does not match"];
  if (user.banned_until && new Date(user.banned_until) > new Date())
    return ["Needs review", "Supabase Auth user is banned"];
  if (!user.email_confirmed_at && !user.confirmed_at)
    return ["Needs review", "Supabase Auth email is not confirmed"];
  if (
    !profile.assignments?.some(
      (assignment) =>
        assignment.block_id === row.block_id &&
        assignment.department === "पंचायती राज विभाग",
    )
  )
    return ["Needs review", "No Panchayati Raj assignment in this block"];
  return [
    "Account linked",
    "Auth, role, phone, block and assignments match; password not tested",
  ];
}

const rows = roster
  .map((row) => {
    const [status, reason] = statusFor(row);
    return {
      block: blockById.get(row.block_id)?.name_en || "Unknown",
      name: row.name,
      phone: row.phone || "",
      status,
      reason,
      roster_id: row.id,
      linked_profile_id: row.linked_profile_id || "",
    };
  })
  .sort(
    (a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name),
  );
const summary = {
  audited_at: new Date().toISOString(),
  roster_rows: rows.length,
  active_roster_rows: activeRoster.length,
  active_staff_profiles: profiles.filter(
    (row) => row.role === "staff" && row.active && !row.deleted_at,
  ).length,
  account_linked: rows.filter((row) => row.status === "Account linked").length,
  needs_review: rows.filter((row) => row.status === "Needs review").length,
  archived_directory_rows: rows.filter((row) => row.status === "Not active")
    .length,
  by_block: Object.fromEntries(
    blocks.map((block) => {
      const group = rows.filter((row) => row.block === block.name_en);
      return [
        block.code,
        {
          directory: group.length,
          account_linked: group.filter((row) => row.status === "Account linked")
            .length,
          needs_review: group.filter((row) => row.status === "Needs review")
            .length,
        },
      ];
    }),
  ),
  password_tested: false,
};
const outputDir = path.resolve("private");
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workbookPath = path.join(outputDir, `staff-login-audit-${stamp}.xlsx`);
const summaryPath = path.join(outputDir, `staff-login-audit-${stamp}.json`);
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet("Staff login audit", {
  views: [{ state: "frozen", ySplit: 1 }],
});
sheet.columns = [
  ["Block", "block", 18],
  ["Staff name", "name", 32],
  ["Mobile", "phone", 18],
  ["Status", "status", 20],
  ["Reason", "reason", 68],
  ["Roster ID", "roster_id", 38],
  ["Linked profile ID", "linked_profile_id", 38],
].map(([header, key, width]) => ({ header, key, width }));
sheet.addRows(rows);
sheet.autoFilter = { from: "A1", to: `G${Math.max(1, sheet.rowCount)}` };
sheet.getRow(1).font = { bold: true };
for (let i = 2; i <= sheet.rowCount; i++) {
  if (sheet.getRow(i).getCell(4).value === "Needs review")
    sheet.getRow(i).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF2B3" },
    };
}
await book.xlsx.writeFile(workbookPath);
await chmod(workbookPath, 0o600);
await writeFile(summaryPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(
    { ...summary, workbook: workbookPath, summary_file: summaryPath },
    null,
    2,
  ),
);
