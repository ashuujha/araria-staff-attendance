// Verify locally saved staff credentials without printing or exporting passwords.
// Dry run by default; --run makes one password sign-in attempt per active account.
import ExcelJS from "exceljs";
import { readFile, mkdir, chmod, writeFile } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(path.resolve("../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!base || !secret || !publishable)
  throw Error("Supabase configuration missing");
const run = process.argv.includes("--run");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function read(endpoint) {
  const response = await fetch(base + endpoint, {
    headers: { apikey: secret },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(`Supabase read returned HTTP ${response.status}`);
  return response.json();
}
const [profiles, blocks, roster] = await Promise.all([
  read(
    "/rest/v1/profiles?select=id,name,phone,login_email,role,active,deleted_at,block_id&limit=1000",
  ),
  read("/rest/v1/blocks?select=id,code,name_en&limit=20"),
  read(
    "/rest/v1/staff_roster?select=id,phone,block_id,active,deleted_at,linked_profile_id&limit=1000",
  ),
]);
if (profiles.length >= 1000 || roster.length >= 1000)
  throw Error("Pagination required");
const blockById = new Map(blocks.map((block) => [block.id, block]));
const credentialPaths = [
  path.resolve("../portal/private/ALL STAFF LOGIN DETAILS.xlsx"),
  ...blocks
    .filter((block) => block.code !== "araria")
    .map((block) =>
      path.resolve(
        `../STAFF CREDENTIALS/BPRO_${block.code.toUpperCase()}_STAFF_CREDENTIALS.xlsx`,
      ),
    ),
];
const credentials = new Map();
for (const file of credentialPaths) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  const header = sheet.getRow(1).values;
  const loginColumn = header.indexOf("Login ID");
  const passwordColumn = header.indexOf("Password");
  if (!loginColumn || !passwordColumn)
    throw Error("Credential columns missing");
  const code = file.includes("ALL STAFF LOGIN DETAILS")
    ? "araria"
    : path
        .basename(file)
        .match(/^BPRO_(.+)_STAFF_CREDENTIALS/)[1]
        .toLowerCase();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const phone = String(row.getCell(loginColumn).value || "").trim();
    const password = String(row.getCell(passwordColumn).value || "");
    if (phone && password) credentials.set(`${code}:${phone}`, password);
  });
}
let newAraria = [];
try {
  newAraria = JSON.parse(
    await readFile("private/new-araria-login-credentials.json", "utf8"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const entry of newAraria)
  credentials.set(`araria:${entry.login_id}`, entry.password);
const currentRoster = roster.filter((row) => row.active && !row.deleted_at);
const rosterByProfile = new Map(
  currentRoster
    .filter((row) => row.linked_profile_id)
    .map((row) => [row.linked_profile_id, row]),
);
const activeProfiles = profiles.filter(
  (profile) =>
    profile.role === "staff" && profile.active && !profile.deleted_at,
);
const activeByPhone = new Map();
for (const profile of activeProfiles)
  activeByPhone.set(profile.phone, (activeByPhone.get(profile.phone) || 0) + 1);
const entries = activeProfiles.map((profile) => {
  const block = blockById.get(profile.block_id);
  return {
    id: profile.id,
    name: profile.name,
    phone: profile.phone,
    email: profile.login_email,
    block: block?.name_en || "Unknown",
    code: block?.code || "unknown",
    block_id: profile.block_id,
    password: credentials.get(`${block?.code}:${profile.phone}`),
    linked: rosterByProfile.get(profile.id)?.phone === profile.phone,
    unique: activeByPhone.get(profile.phone) === 1,
  };
});
const ready = entries.filter(
  (entry) => entry.password && entry.linked && entry.unique && entry.email,
);
console.log(
  JSON.stringify({
    active_staff: entries.length,
    ready_to_test: ready.length,
    missing_credentials_or_roster_link: entries.length - ready.length,
    run,
  }),
);
if (!run) process.exit(0);

const outputDir = path.resolve("private");
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(
  outputDir,
  `individual-signin-verification-${stamp}.xlsx`,
);
const results = [];
for (const entry of entries.filter((entry) => !ready.includes(entry)))
  results.push({
    ...entry,
    status: "Not tested",
    reason: "Credential, roster link, email or unique phone missing",
  });

async function testEntry(entry) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: publishable, "Content-Type": "application/json" },
        body: JSON.stringify({ email: entry.email, password: entry.password }),
        signal: AbortSignal.timeout(12000),
      });
      if (auth.status === 429 || auth.status >= 500) {
        if (attempt < 2) {
          await sleep(15000 * (attempt + 1));
          continue;
        }
        return {
          status: "Service unavailable",
          reason: `Auth HTTP ${auth.status}`,
        };
      }
      if (!auth.ok)
        return {
          status: "Password rejected",
          reason: `Auth HTTP ${auth.status}`,
        };
      const session = await auth.json();
      if (session.user?.id !== entry.id)
        return {
          status: "Wrong account",
          reason: "Auth user ID differs from staff profile",
        };
      const profileResponse = await fetch(
        `${base}/rest/v1/profiles?id=eq.${entry.id}&deleted_at=is.null&select=id,role,active,block_id`,
        {
          headers: {
            apikey: publishable,
            Authorization: `Bearer ${session.access_token}`,
          },
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!profileResponse.ok)
        return {
          status: "Profile inaccessible",
          reason: `Profile HTTP ${profileResponse.status}`,
        };
      const [profile] = await profileResponse.json();
      if (
        profile?.id !== entry.id ||
        profile.role !== "staff" ||
        !profile.active ||
        profile.block_id !== entry.block_id
      )
        return {
          status: "Profile mismatch",
          reason: "Session cannot read the expected active staff profile",
        };
      return {
        status: "Sign-in passed",
        reason: "Password accepted and scoped staff profile visible",
      };
    } catch (error) {
      if (attempt < 2) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return {
        status: "Service unavailable",
        reason: error.name === "TimeoutError" ? "Timeout" : "Network error",
      };
    }
  }
}
for (let index = 0; index < ready.length; index++) {
  const entry = ready[index];
  results.push({ ...entry, ...(await testEntry(entry)) });
  if ((index + 1) % 50 === 0)
    console.log(
      JSON.stringify({
        checked: index + 1,
        total: ready.length,
        passed: results.filter((row) => row.status === "Sign-in passed").length,
        rejected: results.filter((row) => row.status === "Password rejected")
          .length,
      }),
    );
  await sleep(500);
}
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Individual sign-ins", {
  views: [{ state: "frozen", ySplit: 1 }],
});
sheet.columns = [
  { header: "Block", key: "block", width: 18 },
  { header: "Staff", key: "name", width: 32 },
  { header: "Mobile", key: "phone", width: 17 },
  { header: "Result", key: "status", width: 23 },
  { header: "Details", key: "reason", width: 65 },
];
sheet.addRows(
  results.sort(
    (a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name),
  ),
);
sheet.autoFilter = { from: "A1", to: `E${sheet.rowCount}` };
sheet.getRow(1).font = { bold: true };
await workbook.xlsx.writeFile(output);
await chmod(output, 0o600);
const summary = {
  tested: ready.length,
  passed: results.filter((row) => row.status === "Sign-in passed").length,
  rejected: results.filter((row) => row.status === "Password rejected").length,
  unavailable: results.filter((row) => row.status === "Service unavailable")
    .length,
  other: results.filter(
    (row) =>
      !["Sign-in passed", "Password rejected", "Service unavailable"].includes(
        row.status,
      ),
  ).length,
  report: output,
};
await writeFile(
  output.replace(/\.xlsx$/, ".json"),
  JSON.stringify(summary, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(summary));
