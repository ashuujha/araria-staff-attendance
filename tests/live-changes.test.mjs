import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

const db = new PGlite();
await db.exec(
  "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; grant usage on schema auth to authenticated; create schema storage; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
for (const name of (await readdir("supabase/migrations")).sort())
  if (!name.startsWith("20261109") && !name.startsWith("20261110") && !name.startsWith("20261111"))
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));

const admin = "11111111-1111-4111-8111-111111111111";
const staff = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
for (const [id, role, block] of [
  [admin, "super_admin", "Araria"],
  [staff, "staff", "Araria"],
  [other, "staff", "Raniganj"],
]) {
  await db.query("insert into auth.users values($1)", [id]);
  await db.query(
    "insert into profiles(id,name,login_email,role,block) values($1,$2,$3,$4,$5)",
    [id, id, id + "@fixture.invalid", role, block],
  );
}
await db.exec("insert into panchayats(name) values('Office')");
async function as(id, sql) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return (await db.query(sql)).rows[0]?.value;
  } finally {
    await db.exec("reset role");
  }
}
const changes = (id) => as(id, "select portal_changes() value");

test("revision counters stay scoped and react to profile, attendance and office writes", async () => {
  const beforeStaff = await changes(staff),
    beforeOther = await changes(other),
    beforeAdmin = await changes(admin);
  const bootstrap = await as(admin, "select portal_bootstrap() value");
  assert.deepEqual(bootstrap.revisions, beforeAdmin);
  await db.query("update profiles set name='New staff name' where id=$1", [
    staff,
  ]);
  const afterProfile = await changes(staff);
  assert.ok(afterProfile.profile > beforeStaff.profile);
  assert.equal((await changes(other)).profile, beforeOther.profile);
  assert.ok((await changes(admin)).directory > beforeAdmin.directory);
  await db.query(
    "insert into attendance(staff_id,date,panchayat,status,phase,time_in) values($1,'2026-10-21','Office','present','draft','2026-10-21T04:00:00Z')",
    [staff],
  );
  assert.ok((await changes(staff)).attendance > afterProfile.attendance);
  assert.equal((await changes(other)).attendance, beforeOther.attendance);
  await db.query(
    "insert into office_notices(title,body,created_by) values('Notice','Body for staff',$1)",
    [admin],
  );
  assert.ok((await changes(other)).notices > beforeOther.notices);
  await db.query("update profiles set active=false where id=$1", [staff]);
  await assert.rejects(changes(staff), /PORTAL:/);
});

test("optional camera position is stored while ordinary photo uploads remain valid", async () => {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await db.query(
    `update profiles set assignments='[{"panchayat":"Office","department":"पंचायती राज विभाग","position":"Staff"}]' where id=$1`,
    [other],
  );
  const photo = `${other}/${d}/camera.jpg`;
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    photo,
    other,
  ]);
  const saved = await db.query(
    `select save_attendance_with_evidence($1,'save_draft','Office','पंचायती राज विभाग','Staff','present',null,null,null,$2,null,22.5643,88.3693,1200) as record`,
    [other, photo],
  );
  assert.equal(saved.rows[0].record.latitude, 22.5643);
  assert.equal(saved.rows[0].record.longitude, 88.3693);
  assert.equal(saved.rows[0].record.accuracy, 1200);
  const bootstrap = await as(admin, "select portal_bootstrap() value");
  assert.ok(
    bootstrap.records.some(
      (r) => r.staff_id === other && r.latitude === 22.5643,
    ),
  );
});

test("CL and female SL balances enforce annual and monthly limits and restore deleted leave", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const clMonth = month === 1 ? 2 : 1;
  await db.query(
    "update profiles set gender='female',active=true where id=$1",
    [staff],
  );
  await db.query("update profiles set gender='male' where id=$1", [other]);
  const date = (m, d) =>
    `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const workdays = (m, count) =>
    Array.from({ length: 31 }, (_, index) => index + 1)
      .filter((day) => {
        const d = new Date(Date.UTC(year, m - 1, day));
        return d.getUTCMonth() === m - 1 && d.getUTCDay() !== 0;
      })
      .slice(0, count)
      .map((day) => date(m, day));
  const clDates = workdays(clMonth, 17);
  const slDates = workdays(month, 3);
  for (const day of clDates.slice(0, 16))
    await db.query(
      "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','CL')",
      [staff, day],
    );
  await assert.rejects(
    db.query(
      "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','CL')",
      [staff, clDates[16]],
    ),
    /16 CL/,
  );
  await db.query(
    "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
    [staff, slDates[0]],
  );
  await db.query(
    "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
    [staff, slDates[1]],
  );
  await assert.rejects(
    db.query(
      "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
      [staff, slDates[2]],
    ),
    /दोनों SL/,
  );
  await assert.rejects(
    db.query(
      "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
      [other, slDates[2]],
    ),
    /महिला/,
  );
  let snapshot = await as(admin, "select leave_balance_snapshot() value");
  let balance = snapshot.balances.find((row) => row.staff_id === staff);
  assert.equal(balance.cl_left, 0);
  assert.equal(balance.sl_left, 22);
  assert.equal(balance.sl_month_left, 0);
  await db.query(
    "update attendance set deleted_at=now() where staff_id=$1 and date=$2",
    [staff, clDates[0]],
  );
  snapshot = await as(staff, "select leave_balance_snapshot() value");
  balance = snapshot.balances.find((row) => row.staff_id === staff);
  assert.equal(snapshot.balances.length, 1);
  assert.equal(balance.cl_left, 1);
  for (let m = 1; m <= 12; m++) {
    if (m === month) continue;
    const dates = workdays(m, m === clMonth ? 18 : 2);
    for (const leaveDate of m === clMonth ? dates.slice(16, 18) : dates)
      await db.query(
        "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
        [staff, leaveDate],
      );
  }
  await assert.rejects(
    db.query(
      "insert into attendance(staff_id,date,panchayat,status,leave_type) values($1,$2,'Office','leave','SL')",
      [staff, slDates[2]],
    ),
    /24 SL/,
  );
  snapshot = await as(admin, "select leave_balance_snapshot() value");
  assert.equal(
    snapshot.balances.find((row) => row.staff_id === staff).sl_left,
    0,
  );
});

test("admin gender management and typed manual leave use the same quota checks", async () => {
  const newcomer = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into auth.users values($1)", [newcomer]);
  const created = await db.query(
    "select create_master_staff_with_gender($1,$2,'New Staff','9000000044','','9000000044@fixture.invalid','Araria',$3::jsonb,'Administrator added a staff account','female') value",
    [
      admin,
      newcomer,
      JSON.stringify([
        {
          panchayat: "Office",
          department: "पंचायती राज विभाग",
          position: "Staff",
        },
      ]),
    ],
  );
  assert.equal(created.rows[0].value.gender, "female");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const day = new Date(today + "T00:00:00Z");
  if (day.getUTCDay() !== 0) {
    const result = await db.query(
      "select admin_input_attendance_with_leave($1,$2,$3,'Office','leave',null,null,'Administrator entered attendance','SL') value",
      [admin, newcomer, today],
    );
    assert.equal(result.rows[0].value.leave_type, "SL");
    await assert.rejects(
      db.query(
        "select manage_staff_with_gender($1,$2,$3::jsonb,'Administrator updated staff details')",
        [admin, newcomer, JSON.stringify({ gender: "unknown" })],
      ),
      /लिंग/,
    );
    await db.query(
      "select manage_staff_with_gender($1,$2,$3::jsonb,'Administrator updated staff details')",
      [admin, newcomer, JSON.stringify({ gender: "male" })],
    );
    await assert.rejects(
      db.query(
        "select admin_input_attendance_with_leave($1,$2,$3,'Office','leave',null,null,'Administrator entered attendance','SL')",
        [admin, newcomer, today],
      ),
      /महिला/,
    );
  }
});

test("camera repair replaces an old GPS rejection without changing leave balances", async () => {
  const bootstrapBefore = (
    await db.query(
      "select pg_get_functiondef('portal_bootstrap()'::regprocedure) body",
    )
  ).rows[0].body;
  await db.exec(
    await readFile(
      "supabase/migrations/20261015_workplace_evidence.sql",
      "utf8",
    ),
  );
  const stale = (
    await db.query(
      "select pg_get_functiondef(oid) body from pg_proc where proname='save_attendance_with_evidence' and pronamespace='public'::regnamespace",
    )
  ).rows[0].body;
  assert.match(stale, /इस चरण में GPS या फोटो स्वीकार नहीं हैं/);
  await db.exec(
    await readFile(
      "supabase/migrations/20261023_camera_location_repair.sql",
      "utf8",
    ),
  );
  const repaired = (
    await db.query(
      "select pg_get_functiondef(oid) body from pg_proc where proname='save_attendance_with_evidence' and pronamespace='public'::regnamespace",
    )
  ).rows[0].body;
  assert.doesNotMatch(repaired, /इस चरण में GPS या फोटो स्वीकार नहीं हैं/);
  assert.match(repaired, /acc>1000000/);
  const bootstrapAfter = (
    await db.query(
      "select pg_get_functiondef('portal_bootstrap()'::regprocedure) body",
    )
  ).rows[0].body;
  assert.equal(bootstrapAfter, bootstrapBefore);
});
