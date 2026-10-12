import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
await db.query("insert into auth.users(id) values($1),($2),($3)", [
  user,
  admin,
  other,
]);
await db.query(
  `insert into profiles(id,name,phone,login_email,role,device_hash,assignments) values($1,'Staff','9000000001','staff@example.test','staff','device', '[{"panchayat":"Test","position":"Staff","department":"Office"}]'),($2,'Admin',null,'admin@example.test','super_admin',null,'[]'),($3,'Other','9000000002','other@example.test','staff','other-device','[]')`,
  [user, admin, other],
);
await db.exec(
  "insert into panchayats(name,latitude,longitude) values('Test',26.15,87.46);",
);
async function challenge() {
  return (
    await db.query(
      "insert into capture_challenges(staff_id,device_hash) values($1,$2) returning id",
      [user, "device"],
    )
  ).rows[0].id;
}
async function submit(action, lat, lng, acc, capture, hash = "unique-photo") {
  return db.query(
    `select submit_attendance($1,$2,'Test',$3,$4,$5,$6,'device',$7,$8,null,'test') as record`,
    [
      user,
      action,
      lat,
      lng,
      acc,
      capture,
      `${user}/${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}/test.jpg`,
      hash,
    ],
  );
}
test("SQL blocks low accuracy and out-of-geofence without recording attendance", async () => {
  const c = await challenge();
  await assert.rejects(submit("in", 26.15, 87.46, 100, c), /सटीकता/);
  await assert.rejects(submit("in", 27, 88, 20, c), /दायरे/);
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    0,
  );
});
test("SQL refuses stale capture and out before in", async () => {
  const c = await challenge();
  await db.query(
    "update capture_challenges set expires_at=now()-interval '1 second' where id=$1",
    [c],
  );
  await assert.rejects(submit("in", 26.15, 87.46, 10, c), /सत्यापन समाप्त/);
  await assert.rejects(submit("out", 26.15, 87.46, 10, c), /पंच आउट से पहले/);
});
test("atomic punch prevents racing duplicate punches and creates durable sync job", async () => {
  const c = await challenge();
  const results = await Promise.allSettled([
    submit("in", 26.15, 87.46, 10, c),
    submit("in", 26.15, 87.46, 10, c),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*) as n from sync_jobs")).rows[0].n,
    1,
  );
});
test("photo reuse is rejected and punch out updates the same record", async () => {
  const c = await challenge();
  await assert.rejects(submit("out", 26.15, 87.46, 10, c), /फोटो का पहले/);
  await submit("out", 26.15, 87.46, 10, c, "fresh-out-photo");
  await assert.rejects(
    submit("out", 26.15, 87.46, 10, await challenge(), "third-photo"),
    /दोबारा पंच आउट/,
  );
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select version from sync_jobs")).rows[0].version,
    2,
  );
});
test("device binding rejects a different browser", async () => {
  await assert.rejects(
    db.query("select bind_device($1,$2)", [user, "another-device"]),
    /दूसरे डिवाइस/,
  );
});
test("correction requires reason and records old/new values atomically", async () => {
  const id = (await db.query("select id from attendance")).rows[0].id;
  await assert.rejects(
    db.query("select correct_attendance($1,$2,'{}','no')", [admin, id]),
    /कारण/,
  );
  await db.query(
    "select correct_attendance($1,$2,'{}','Verified original attendance')",
    [admin, id],
  );
  assert.equal(
    (await db.query("select count(*) as n from audit_logs")).rows[0].n,
    1,
  );
});
test("RLS prevents staff reading another staff attendance or changing roles", async () => {
  await db.exec(
    `grant usage on schema auth to authenticated;set role authenticated;set request.jwt.claim.sub='${other}';`,
  );
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    0,
  );
  await assert.rejects(
    db.query("update profiles set role='super_admin' where id=$1", [other]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select device_hash from profiles"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select bind_device($1,'bypass')", [other]),
    /permission denied/,
  );
  await db.exec("reset role;");
});
test("queue retry preserves pending attendance and backs off", async () => {
  const job = (await db.query("select claim_sync_job() as job")).rows[0].job;
  assert.ok(job.record_id);
  await db.query("select finish_sync_job($1,$2,'Google offline')", [
    job.record_id,
    job.version,
  ]);
  const r = (await db.query("select * from sync_jobs")).rows[0];
  assert.equal(r.state, "pending");
  assert.equal(r.attempts, 1);
  assert.equal(r.last_error, "Google offline");
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
});
