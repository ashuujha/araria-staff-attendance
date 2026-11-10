// Run prepare-block-rosters.mjs first. No Auth users or passwords are created.
import { readFile } from "node:fs/promises";
import path from "node:path";

const apply = process.argv.includes("--apply");
const replaceAraria = process.argv.includes("--replace-araria");
process.loadEnvFile(path.resolve(process.cwd(), "../portal/.env.local"));
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase configuration missing");
const preview = JSON.parse(
  await readFile("private/block-roster-preview.json", "utf8"),
);
const blockOption = process.argv.find((argument) => argument.startsWith("--blocks="));
const selectedCodes = blockOption
  ? blockOption.slice("--blocks=".length).split(",").map((code) => code.trim())
  : Object.keys(preview.summary);
if (
  !selectedCodes.length ||
  selectedCodes.some((code) => !preview.summary[code]) ||
  new Set(selectedCodes).size !== selectedCodes.length
)
  throw Error("--blocks must list distinct block codes present in the preview");
if (replaceAraria && !selectedCodes.includes("araria"))
  throw Error("--replace-araria requires araria in --blocks");
const selected = new Set(selectedCodes);
const incomingSummary = Object.fromEntries(
  selectedCodes.map((code) => [code, preview.summary[code]]),
);
const people = preview.people.filter((person) => selected.has(person.block));
if (!people.length) throw Error("No staff found for selected blocks");
const api = async (endpoint, method = "GET", body, extraHeaders = {}) => {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      `Supabase ${method} ${endpoint.split("?")[0]} failed: HTTP ${response.status}`,
    );
  const content = await response.text();
  return content ? JSON.parse(content) : null;
};
const blocks = await api("/rest/v1/blocks?select=id,code,name_en&limit=20");
const blockByCode = new Map(blocks.map((block) => [block.code, block]));
for (const code of selectedCodes)
  if (!blockByCode.has(code)) throw Error(`Missing block code: ${code}`);
const araria = blockByCode.get("araria");
const dproRows = await api(
  "/rest/v1/profiles?role=eq.dpro&active=eq.true&deleted_at=is.null&select=id&limit=2",
);
if (dproRows.length !== 1)
  throw Error("Expected exactly one active DPRO for import audit");
const dproId = dproRows[0].id;
const oldProfiles = await api(
  `/rest/v1/profiles?role=eq.staff&block_id=eq.${araria.id}&deleted_at=is.null&select=id,name,phone,active&limit=1000`,
);
if (oldProfiles.length >= 1000)
  throw Error("Araria profile count exceeds review limit");
let existingRoster = [];
try {
  existingRoster = await api(
    "/rest/v1/staff_roster?select=id,source_key,block_id,deleted_at&limit=1000",
  );
} catch (error) {
  if (apply) throw error;
  console.log("Roster migration has not been applied yet.");
}
const selectedBlockIds = new Set(selectedCodes.map((code) => blockByCode.get(code).id));
const scopedRoster = existingRoster.filter((row) => selectedBlockIds.has(row.block_id));
const existingKeys = new Set(scopedRoster.map((row) => row.source_key));
const incomingKeys = new Set(people.map((row) => row.source_key));
const workplaces = new Map();
for (const person of people)
  for (const assignment of person.assignments) {
    const block = blockByCode.get(person.block);
    workplaces.set(`${block.id}|${assignment.panchayat}`, {
      block_id: block.id,
      block: block.name_en,
      name: assignment.panchayat,
    });
  }
console.log(
  JSON.stringify(
    {
      incoming: incomingSummary,
      distinct_workspaces: workplaces.size,
      rows_to_insert: people.filter(
        (row) => !existingKeys.has(row.source_key),
      ).length,
      rows_to_update: people.filter((row) =>
        existingKeys.has(row.source_key),
      ).length,
      existing_roster_not_in_workbooks: scopedRoster.filter(
        (row) => row.source_key && !incomingKeys.has(row.source_key),
      ).length,
      old_araria_profiles_to_soft_archive: replaceAraria
        ? oldProfiles.length
        : 0,
      old_araria_profiles_currently_visible: oldProfiles.length,
      historical_attendance_deleted: 0,
      staff_auth_accounts_created: 0,
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);
const places = [...workplaces.values()];
for (let i = 0; i < places.length; i += 100)
  await api(
    "/rest/v1/panchayats?on_conflict=block_id,name",
    "POST",
    places.slice(i, i + 100),
    { Prefer: "resolution=ignore-duplicates,return=minimal" },
  );
const rows = people.map((person) => ({
  block_id: blockByCode.get(person.block).id,
  name: person.name,
  phone: person.phone,
  email: person.email,
  gender: person.gender,
  assignments: person.assignments.map((assignment) => ({
    ...assignment,
    block_id: blockByCode.get(person.block).id,
  })),
  source_key: person.source_key,
  active: true,
  deleted_at: null,
}));
for (let i = 0; i < rows.length; i += 100) {
  await api(
    "/rest/v1/staff_roster?on_conflict=source_key",
    "POST",
    rows.slice(i, i + 100),
    { Prefer: "resolution=merge-duplicates,return=minimal" },
  );
  console.log(`Imported ${Math.min(rows.length, i + 100)}/${rows.length}`);
}
const saved = await api(
  "/rest/v1/staff_roster?deleted_at=is.null&select=source_key,block_id&limit=1000",
);
const savedKeys = new Set(saved.map((row) => row.source_key));
if (people.some((row) => !savedKeys.has(row.source_key)))
  throw Error(
    "Roster verification failed; old Araria accounts were not changed",
  );
for (const [code, summary] of Object.entries(incomingSummary))
  await api("/rest/v1/audit_logs", "POST", {
    actor_id: dproId,
    action: "import_block_roster",
    target_id: code,
    reason: "Block workbook import",
    details: { entries: summary.staff },
    block_id: blockByCode.get(code).id,
  });
if (replaceAraria) {
  if (oldProfiles.length > 300)
    throw Error("Araria archive exceeds 300-account safety limit");
  await api(
    `/rest/v1/profiles?role=eq.staff&block_id=eq.${araria.id}&deleted_at=is.null`,
    "PATCH",
    { active: false, deleted_at: new Date().toISOString() },
    { Prefer: "return=minimal" },
  );
  const remaining = await api(
    `/rest/v1/profiles?role=eq.staff&block_id=eq.${araria.id}&deleted_at=is.null&select=id&limit=1`,
  );
  if (remaining.length)
    throw Error("Old Araria profiles were not fully archived");
  await api("/rest/v1/audit_logs", "POST", {
    actor_id: dproId,
    action: "archive_old_araria_directory",
    target_id: araria.id,
    reason: "Replaced by BPRO_ARARIA.xlsx roster",
    details: { profiles: oldProfiles.length, attendance_deleted: 0 },
    block_id: araria.id,
  });
  console.log(
    `Soft-archived ${oldProfiles.length} former Araria staff accounts; attendance history remains.`,
  );
}
console.log("Roster import complete. No staff login was created.");
