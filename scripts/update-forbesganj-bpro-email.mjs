// Updates the existing Forbesganj BPRO identity; never creates a second BPRO.
const apply = process.argv.includes("--apply");
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!base || !key) throw Error("Supabase server configuration is required.");
const desired = "bproforbeshganj@gmail.com";
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
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
const blocks = await api("/rest/v1/blocks?name_en=eq.Forbesganj&select=id");
if (blocks.length !== 1) throw Error("Expected exactly one Forbesganj block.");
const profiles = await api(
  `/rest/v1/profiles?role=eq.bpro&block_id=eq.${blocks[0].id}&active=eq.true&deleted_at=is.null&select=id,email,login_email`,
);
if (profiles.length !== 1)
  throw Error("Expected exactly one active Forbesganj BPRO.");
const profile = profiles[0];
const users = [];
for (let page = 1; ; page++) {
  const result = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  users.push(...result.users);
  if (result.users.length < 1000) break;
}
const user = users.find((entry) => entry.id === profile.id);
if (!user) throw Error("Forbesganj BPRO Auth account not found.");
if (
  users.some(
    (entry) =>
      entry.email?.toLowerCase() === desired && entry.id !== profile.id,
  )
)
  throw Error("Desired email is already used by another account.");
if (profile.login_email !== user.email)
  throw Error("Auth and profile login emails differ; inspect before updating.");
if (user.email === desired) {
  console.log("Forbesganj BPRO login already uses the requested email.");
  process.exit(0);
}
console.log(
  `Forbesganj BPRO: ${user.email} -> ${desired}; same account ID and password.`,
);
if (!apply) process.exit(0);
await api(`/auth/v1/admin/users/${user.id}`, "PUT", {
  email: desired,
  email_confirm: true,
});
try {
  const changed = await api(
    `/rest/v1/profiles?id=eq.${user.id}&role=eq.bpro&block_id=eq.${blocks[0].id}&select=id,login_email`,
    "PATCH",
    { email: desired, login_email: desired },
  );
  if (changed.length !== 1)
    throw Error("Profile update matched no BPRO account.");
} catch (error) {
  await api(`/auth/v1/admin/users/${user.id}`, "PUT", {
    email: user.email,
    email_confirm: true,
  });
  throw error;
}
console.log("Forbesganj BPRO login email updated; password unchanged.");
