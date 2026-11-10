import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;grant usage on schema auth to authenticated;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
for (const file of (await readdir("supabase/migrations")).sort())
  if (!file.startsWith("20261109") && !file.startsWith("20261110"))
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
const admin = "11111111-1111-4111-8111-111111111111",
  staff = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333",
  viewer = "44444444-4444-4444-8444-444444444444";
for (const [index, id, role, block] of [
  [1, admin, "super_admin", "Araria"],
  [2, staff, "staff", "Araria"],
  [3, other, "staff", "Raniganj"],
  [4, viewer, "district_viewer", "Araria"],
]) {
  await db.query("insert into auth.users values($1)", [id]);
  await db.query(
    "insert into profiles(id,name,login_email,role,block) values($1,$2,$3,$4,$5)",
    [id, "Fixture " + index, index + "@fixture.invalid", role, block],
  );
}
await db.exec("insert into panchayats(name) values('Office');");
const manage = async (action, payload, actor = admin) =>
  (
    await db.query("select manage_office_board($1,$2,$3::jsonb) as result", [
      actor,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
async function readAs(id, query) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await db.query(query);
  } finally {
    await db.exec("reset role");
  }
}
function attendance(date, status = "present") {
  return db.query(
    "insert into attendance(staff_id,date,panchayat,status,phase,time_in,leave_type) values($1,$2,'Office',$3,'draft','2026-10-19T04:00:00Z',case when $3='leave' then 'CL' else null end) returning id",
    [staff, date, status],
  );
}
test("holiday dates and Sunday blocking are enforced inside the database for all statuses", async () => {
  for (const status of ["present", "absent", "leave", "deputation"])
    await assert.rejects(attendance("2026-10-18", status), /Holiday.*Sunday/);
  await manage("set_holiday", {
    date: "2026-10-19",
    reason: "Office closed for festival",
  });
  for (const status of ["present", "absent", "leave", "deputation"])
    await assert.rejects(attendance("2026-10-19", status), /Holiday.*festival/);
  await manage("set_holiday", {
    date: "2026-10-19",
    reason: "Updated festival reason",
  });
  assert.equal(
    (
      await db.query(
        "select reason from office_holidays where date='2026-10-19'",
      )
    ).rows[0].reason,
    "Updated festival reason",
  );
  await manage("remove_holiday", { date: "2026-10-19" });
  const record = (await attendance("2026-10-19")).rows[0];
  await manage("set_holiday", {
    date: "2026-10-19",
    reason: "Office closes early",
  });
  await assert.rejects(
    db.query(
      "update attendance set time_out='2026-10-19T10:00:00Z' where id=$1",
      [record.id],
    ),
    /Holiday/,
  );
  assert.equal(
    (
      await db.query("select count(*)::int as n from attendance where id=$1", [
        record.id,
      ])
    ).rows[0].n,
    1,
    "Existing attendance must be preserved",
  );
  await manage("remove_holiday", { date: "2026-10-19" });
  await db.query(
    "update attendance set time_out='2026-10-19T10:00:00Z' where id=$1",
    [record.id],
  );
  await manage("set_holiday", {
    date: "2026-10-18",
    reason: "Sunday festival",
  });
  await manage("remove_holiday", { date: "2026-10-18" });
  await assert.rejects(attendance("2026-10-18"), /Sunday/);
});
test("staff across blocks see the same notices; staff/viewers cannot write; removals disappear", async () => {
  for (const actor of [staff, viewer])
    await assert.rejects(
      manage(
        "publish_notice",
        { title: "Important notice", body: "Office meeting at 10 AM" },
        actor,
      ),
      /PORTAL:/,
    );
  const notice = await manage("publish_notice", {
    title: "Important notice",
    body: "Office meeting at 10 AM",
  });
  const query = "select id,title,body from office_notices";
  assert.deepEqual(
    (await readAs(staff, query)).rows,
    (await readAs(other, query)).rows,
  );
  assert.equal((await readAs(staff, query)).rows.length, 1);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      manage(
        "publish_notice",
        { title: "Unsafe notice", body: "Cannot write" },
        admin,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into office_notices(title,body,created_by) values('Unsafe','Cannot write',$1)",
        [staff],
      ),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
  await manage("remove_notice", { id: notice.id });
  assert.equal((await readAs(staff, query)).rows.length, 0);
  assert.ok(
    (
      await db.query(
        "select count(*)::int as n from audit_logs where action in ('publish_notice','remove_notice')",
      )
    ).rows[0].n >= 2,
  );
  await manage("set_holiday", {
    date: "2026-10-20",
    reason: "Festival holiday",
  });
  assert.equal(
    (await readAs(staff, "select * from office_holidays")).rows.length,
    1,
  );
  await db.query("update profiles set active=false where id=$1", [other]);
  assert.equal(
    (await readAs(other, "select * from office_holidays")).rows.length,
    0,
  );
});
test("database rejects empty reasons, invalid dates and blank notices", async () => {
  for (const [action, payload] of [
    ["set_holiday", { date: "2026-10-20", reason: " " }],
    ["set_holiday", { date: "2026-02-30", reason: "Bad date" }],
    ["publish_notice", { title: " ", body: "Valid body" }],
  ])
    await assert.rejects(manage(action, payload));
});

test("fast-start SQL keeps staff and block admins within RLS and excludes private identity fields", async () => {
  const query = "select portal_bootstrap() as data";
  const extra = "55555555-5555-4555-8555-555555555555";
  await db.query("insert into auth.users values($1)", [extra]);
  await db.query(
    "insert into profiles(id,name,login_email,role,block) values($1,'Raniganj staff','extra@fixture.invalid','staff','Raniganj')",
    [extra],
  );
  await db.query(
    "insert into attendance(staff_id,date,panchayat,status,block) values($1,(now() at time zone 'Asia/Kolkata')::date,'Office','present','Araria'),($2,(now() at time zone 'Asia/Kolkata')::date,'Office','present','Raniganj')",
    [staff, extra],
  );
  const own = (await readAs(staff, query)).rows[0].data;
  assert.equal(own.profile.id, staff);
  assert.deepEqual(own.staff, []);
  assert.equal(own.records.length, 1);
  assert.ok(own.records.every((row) => row.staff_id === staff));
  assert.ok(Array.isArray(own.office.holidays));
  assert.ok(!JSON.stringify(own).includes("login_email"));
  assert.ok(!JSON.stringify(own).includes("device_hash"));
  const all = (await readAs(admin, query)).rows[0].data;
  assert.ok(all.staff.some((person) => person.id === staff));
  await db.query(
    "update profiles set role='block_admin',active=true where id=$1",
    [other],
  );
  const scoped = (await readAs(other, query)).rows[0].data;
  assert.equal(scoped.staff.length, 1);
  assert.equal(scoped.records.length, 1);
  assert.ok(scoped.staff.every((person) => person.block === "Raniganj"));
  assert.ok(scoped.records.every((row) => row.block === "Raniganj"));
  await db.query("update profiles set active=false where id=$1", [other]);
  await assert.rejects(readAs(other, query), /PORTAL:/);
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query(query), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
