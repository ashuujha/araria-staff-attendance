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
    `update profiles set assignments='[{"panchayat":"Office","department":"Office","position":"Staff"}]' where id=$1`,
    [other],
  );
  const photo = `${other}/${d}/camera.jpg`;
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    photo,
    other,
  ]);
  const saved = await db.query(
    `select save_attendance_with_evidence($1,'save_draft','Office','Office','Staff','present',null,null,null,$2,null,22.5643,88.3693,1200) as record`,
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
