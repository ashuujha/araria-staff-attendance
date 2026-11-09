import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const apply = process.argv.includes("--apply");
const rotate = process.argv.includes("--rotate-passwords");
const configIndex = process.argv.indexOf("--config");
const configPath = resolve(
  configIndex < 0 ? "private/seed-admins.json" : process.argv[configIndex + 1],
);
if (!configPath.includes("/private/"))
  throw Error("Admin config must be inside gitignored private/.");
const config = JSON.parse(await readFile(configPath, "utf8"));
const expectedBlocks = [
  "Araria",
  "Bhargama",
  "Forbesganj",
  "Jokihat",
  "Kursakanta",
  "Narpatganj",
  "Palasi",
  "Raniganj",
  "Sikti",
];
if (
  !config?.dpro ||
  !Array.isArray(config.bpros) ||
  config.bpros.length !== 9 ||
  expectedBlocks.some(
    (name) =>
      config.bpros.filter((entry: { block: string }) => entry.block === name)
        .length !== 1,
  )
)
  throw Error(
    "Provide exactly one DPRO and one BPRO for each of the nine blocks.",
  );
const entries = [
  { ...config.dpro, role: "dpro", block: "Araria" },
  ...config.bpros.map((entry: object) => ({ ...entry, role: "bpro" })),
];
const emails = new Set<string>();
for (const entry of entries) {
  if (
    typeof entry.name !== "string" ||
    entry.name.trim().length < 2 ||
    typeof entry.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email) ||
    typeof entry.password !== "string" ||
    entry.password.length < 14 ||
    entry.password.includes("REPLACE_WITH") ||
    emails.has(entry.email.toLowerCase())
  )
    throw Error("Invalid, duplicate or placeholder admin configuration.");
  emails.add(entry.email.toLowerCase());
}
if (!apply) {
  console.log(
    "Validated one DPRO and nine BPRO entries. No changes made. Use --apply after database migrations.",
  );
  process.exit(0);
}
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key)
  throw Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY privately.");
async function api(path: string, method = "GET", body?: object) {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key!,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw Error(
      `Supabase ${method} failed (${response.status}) at ${path.split("?")[0]}`,
    );
  return response.status === 204 ? null : response.json();
}
const blocks = await api("/rest/v1/blocks?active=eq.true&select=id,name_en");
const blockIds = new Map(
  blocks.map((block: { id: string; name_en: string }) => [
    block.name_en,
    block.id,
  ]),
);
if (expectedBlocks.some((name) => !blockIds.has(name)))
  throw Error("Apply the blocks migration first.");
const users = [];
for (let page = 1; ; page++) {
  const result = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  users.push(...result.users);
  if (result.users.length < 1000) break;
}
const byEmail = new Map(
  users.map((user: { email: string }) => [user.email?.toLowerCase(), user]),
);
const currentDpros = await api(
  "/rest/v1/profiles?role=eq.dpro&active=eq.true&deleted_at=is.null&select=id,login_email",
);
if (
  currentDpros.some(
    (row: { login_email: string }) =>
      row.login_email.toLowerCase() !== config.dpro.email.toLowerCase(),
  )
)
  throw Error(
    "A different active DPRO exists. Review it manually; this script will not replace the super admin.",
  );
for (const entry of entries) {
  const email = entry.email.toLowerCase();
  let user = byEmail.get(email);
  if (!user) {
    user = await api("/auth/v1/admin/users", "POST", {
      email,
      password: entry.password,
      email_confirm: true,
      user_metadata: { name: entry.name },
    });
  } else if (rotate) {
    await api(`/auth/v1/admin/users/${user.id}`, "PUT", {
      password: entry.password,
    });
  }
  const existing = await api(
    `/rest/v1/profiles?id=eq.${user.id}&select=id,role,block_id,login_email`,
  );
  const blockId = blockIds.get(entry.block);
  if (existing.length && ![entry.role].includes(existing[0].role))
    throw Error(
      `Existing account for ${email} has a different role; review manually.`,
    );
  const row = {
    name: entry.name,
    email,
    login_email: email,
    role: entry.role,
    block: entry.block,
    block_id: blockId,
    active: true,
  };
  if (existing.length) {
    await api(`/rest/v1/profiles?id=eq.${user.id}`, "PATCH", row);
  } else {
    await api("/rest/v1/profiles", "POST", {
      id: user.id,
      assignments: [],
      ...row,
    });
  }
  console.log(`${entry.role.toUpperCase()} ${entry.block}: ready`);
}
console.log(
  "Admin seed complete. Existing passwords were changed only if --rotate-passwords was supplied.",
);
