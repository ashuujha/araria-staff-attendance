import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
after(() => db.close());
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
await db.exec(
  (await readFile("supabase/schema.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  ),
);
for (const file of (await readdir("supabase/migrations")).sort())
  await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
const users = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
for (let i = 0; i < users.length; i++) {
  await db.query("insert into auth.users values($1)", [users[i]]);
  await db.query(
    `insert into profiles(id,name,phone,login_email,device_hash,assignments) values($1,$2,$3,$4,'device','[{"panchayat":"Office","department":"Department","position":"Staff"}]')`,
    [users[i], "Staff " + i, "900000000" + i, "user" + i + "@test.invalid"],
  );
}
await db.exec(`insert into panchayats(name) values('Office');`);
const day = (
  await db.query(
    "select (now() at time zone 'Asia/Kolkata')::date::text as day",
  )
).rows[0].day;
async function params(user, status = "present") {
  const path = user + "/" + day + "/" + status + ".jpg";
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    path,
    user,
  ]);
  const ch = (
    await db.query(
      "insert into capture_challenges(staff_id,device_hash) values($1,'device') returning id",
      [user],
    )
  ).rows[0].id;
  return [
    user,
    "save_draft",
    "Office",
    "Department",
    "Staff",
    status,
    status === "deputation" ? "District office" : null,
    null,
    "device",
    path,
    null,
    26,
    87,
    10,
    ch,
    user,
    users.indexOf(user).toString(2).padStart(64, "0"),
    null,
    "test",
  ];
}
function save(args) {
  return db
    .query(
      "select save_attendance_workflow(" +
        args.map((_, i) => "$" + (i + 1)).join(",") +
        ") as record",
      args,
    )
    .then((r) => r.rows[0].record);
}
function complete(user) {
  return save([user, "complete", null, null, null, null, null, null, "device"]);
}
test("draft is persisted with server in time, snapshots and admin visibility; racing requests create one row", async () => {
  const p = await params(users[0]);
  const race = await Promise.allSettled([save(p), save(p)]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  const r = race.find((r) => r.status === "fulfilled").value;
  assert.equal(r.phase, "draft");
  assert.ok(r.time_in);
  assert.equal(r.time_out, null);
  assert.equal(r.staff_name, "Staff 0");
  assert.equal(r.department, "Department");
  assert.equal(r.working_places.length, 1);
  assert.deepEqual(r.flags, ["geofence_unconfigured"]);
  await db.query("update profiles set role='super_admin' where id=$1", [
    users[4],
  ]);
  await db.exec(
    `grant usage on schema auth to authenticated;set role authenticated;set request.jwt.claim.sub='${users[4]}';`,
  );
  assert.equal(
    (await db.query("select count(*) as n from attendance")).rows[0].n,
    1,
  );
  await db.exec("reset role");
  const out = await complete(users[0]);
  assert.equal(out.id, r.id);
  assert.equal(out.phase, "submitted");
  assert.ok(out.time_out);
  assert.equal(out.version, 2);
  await assert.rejects(complete(users[0]), /ड्राफ्ट/);
});
test("absent and CL leave have no fabricated time and cannot be completed; leave attachment required", async () => {
  for (const [user, status, kind] of [
    [users[1], "absent", null],
    [users[2], "leave", "CL"],
  ]) {
    const attachment = status === "leave" ? `${user}/${day}/cl.pdf` : null;
    if (attachment)
      await db.query(
        "insert into pending_uploads(path,staff_id) values($1,$2)",
        [attachment, user],
      );
    const args = [
      user,
      "save_status",
      "Office",
      "Department",
      "Staff",
      status,
      null,
      kind,
      "device",
      null,
      attachment,
    ];
    if (status === "leave")
      await assert.rejects(
        save([...args.slice(0, 10), null]),
        /दस्तावेज आवश्यक/,
      );
    const r = await save(args);
    assert.equal(r.phase, "submitted");
    assert.equal(r.time_in, null);
    assert.equal(r.time_out, null);
    assert.equal(r.leave_path, attachment);
    assert.equal(r.leave_type, kind);
    await assert.rejects(complete(user), /ड्राफ्ट/);
  }
});
test("deputation requires named workplace; upload ownership and freshness and assignment are enforced", async () => {
  const p = await params(users[3], "deputation");
  const invalid = [...p];
  invalid[6] = "";
  await assert.rejects(save(invalid), /कार्यस्थल का नाम/);
  invalid[6] = "District office";
  invalid[9] = users[0] + "/" + day + "/stolen.jpg";
  await assert.rejects(save(invalid), /स्वामी/);
  invalid[9] = p[9];
  invalid[3] = "Wrong";
  await assert.rejects(save(invalid), /नियुक्ति/);
  await db.query(
    "update pending_uploads set expires_at=now()-interval '1 second' where path=$1",
    [p[9]],
  );
  await assert.rejects(save(p), /अपलोड/);
  await db.query(
    "update pending_uploads set expires_at=now()+interval '1 minute' where path=$1",
    [p[9]],
  );
  const r = await save(p);
  assert.equal(r.deputation_workplace, "District office");
  assert.equal(r.status, "deputation");
  assert.equal(
    (
      await db.query("select consumed from pending_uploads where path=$1", [
        p[9],
      ])
    ).rows[0].consumed,
    true,
  );
  await assert.rejects(complete(users[4]), /खाता/);
});
test("RLS prevents other staff reading draft or invoking trusted workflow RPC", async () => {
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${users[1]}';`,
  );
  assert.equal(
    (
      await db.query("select count(*) as n from attendance where staff_id=$1", [
        users[3],
      ])
    ).rows[0].n,
    0,
  );
  await assert.rejects(complete(users[3]), /permission denied/);
  await db.exec("reset role");
});

test("SL evidence consumes owned attachment atomically without a camera challenge", async () => {
  const user = "66666666-6666-4666-8666-666666666666";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    `insert into profiles(id,name,phone,login_email,device_hash,assignments,gender) values($1,'SL Staff','9000000006','sl@test.invalid','device','[{"panchayat":"Office","department":"Department","position":"Staff"}]','female')`,
    [user],
  );
  const path = user + "/" + day + "/leave.pdf";
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    path,
    user,
  ]);
  const r = await save([
    user,
    "save_status",
    "Office",
    "Department",
    "Staff",
    "leave",
    null,
    "SL",
    "device",
    null,
    path,
  ]);
  assert.equal(r.leave_type, "SL");
  assert.equal(r.leave_path, path);
  assert.equal(r.time_in, null);
  assert.equal(
    (
      await db.query("select consumed from pending_uploads where path=$1", [
        path,
      ])
    ).rows[0].consumed,
    true,
  );
});

test("configured fences block present outside, while named deputation records GPS with flag; camera replay is refused", async () => {
  const user = "77777777-7777-4777-8777-777777777777";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    `insert into profiles(id,name,phone,login_email,device_hash,assignments) values($1,'Fence Staff','9000000007','fence@test.invalid','device','[{"panchayat":"Office","department":"Department","position":"Staff"}]')`,
    [user],
  );
  await db.exec("update panchayats set latitude=27,longitude=88");
  const p = await params(user);
  p[16] = "11".padStart(64, "0");
  await assert.rejects(save(p), /दायरे/);
  p[5] = "deputation";
  p[6] = "Named other office";
  await assert.rejects(save(p), /फोटो का पहले/);
  p[16] = "101".padStart(64, "0");
  const r = await save(p);
  assert.deepEqual(r.flags, ["deputation_location_recorded"]);
  assert.equal(r.latitude, 26);
  assert.equal(r.deputation_workplace, "Named other office");
});

test("migration backfills unfinished legacy present records as completable drafts", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    await legacy.exec(
      (await readFile("supabase/schema.sql", "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
    await legacy.exec(
      await readFile(
        "supabase/migrations/20261012_master_data_shared_attendance.sql",
        "utf8",
      ),
    );
    await legacy.query("insert into auth.users values($1)", [users[0]]);
    await legacy.query(
      `insert into profiles(id,name,login_email,device_hash,assignments) values($1,'Existing','legacy@test.invalid','device','[{"panchayat":"Legacy","department":"Department","position":"Staff"}]')`,
      [users[0]],
    );
    await legacy.exec(`insert into panchayats(name) values('Legacy');`);
    await legacy.query(
      `insert into attendance(staff_id,panchayat,status,time_in) values($1,'Legacy','present',now())`,
      [users[0]],
    );
    await legacy.exec(
      await readFile(
        "supabase/migrations/20261013_simple_attendance.sql",
        "utf8",
      ),
    );
    const r = (await legacy.query("select * from attendance")).rows[0];
    assert.equal(r.phase, "draft");
    assert.equal(r.staff_name, "Existing");
    const completed = (
      await legacy.query(
        `select save_attendance_workflow($1,'complete',null,null,null,null,null,null,'device') as record`,
        [users[0]],
      )
    ).rows[0].record;
    assert.equal(completed.id, r.id);
    assert.equal(completed.phase, "submitted");
    assert.ok(completed.time_out);
  } finally {
    await legacy.close();
  }
});

test("basic onboarding arrival ignores old browser binding and requires no GPS; checkout keeps same record", async () => {
  const user = "99999999-9999-4999-8999-999999999999";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    `insert into profiles(id,name,phone,login_email,device_hash,assignments) values($1,'Basic Staff','9000000009','basic@test.invalid','old-browser','[{"panchayat":"Office","department":"Department","position":"Staff"}]')`,
    [user],
  );
  await db.exec(
    "update panchayats set latitude=0,longitude=0,radius=50,mode='block' where name='Office'",
  );
  const basic = async (args) =>
    (
      await db.query(
        "select save_attendance_basic(" +
          args.map((_, i) => "$" + (i + 1)).join(",") +
          ") as record",
        args,
      )
    ).rows[0].record;
  const args = [
    user,
    "save_draft",
    "Office",
    "Department",
    "Staff",
    "present",
    null,
    null,
    null,
  ];
  const race = await Promise.allSettled([basic(args), basic(args)]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  const arrival = race.find((r) => r.status === "fulfilled").value;
  assert.equal(arrival.phase, "draft");
  assert.ok(arrival.time_in);
  for (const field of [
    "latitude",
    "longitude",
    "accuracy",
    "photo_path",
    "photo_hash",
  ])
    assert.equal(arrival[field], null, field);
  assert.deepEqual(arrival.flags, []);
  const out = await basic([
    user,
    "complete",
    null,
    null,
    null,
    null,
    null,
    null,
    "a-different-browser",
  ]);
  assert.equal(out.id, arrival.id);
  assert.ok(out.time_out);
  assert.equal(out.phase, "submitted");
  await assert.rejects(
    basic([user, "complete", null, null, null, null, null, null, null]),
    /ड्राफ्ट/,
  );
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${users[4]}';`,
  );
  assert.equal(
    (
      await db.query("select count(*) as n from attendance where id=$1", [
        arrival.id,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(basic(args), /permission denied/);
  await db.exec("reset role");
});

test("basic onboarding preserves required owned leave evidence and assignment validation", async () => {
  const user = "88888888-8888-4888-8888-888888888888";
  await db.query("insert into auth.users values($1)", [user]);
  await db.query(
    `insert into profiles(id,name,phone,login_email,assignments) values($1,'Basic Leave','9000000008','basic-leave@test.invalid','[{"panchayat":"Office","department":"Department","position":"Staff"}]')`,
    [user],
  );
  const basic = async (args) =>
    (
      await db.query(
        "select save_attendance_basic(" +
          args.map((_, i) => "$" + (i + 1)).join(",") +
          ") as record",
        args,
      )
    ).rows[0].record;
  const args = [
    user,
    "save_status",
    "Office",
    "Department",
    "Staff",
    "leave",
    null,
    "CL",
    null,
    null,
    null,
  ];
  await assert.rejects(basic(args), /दस्तावेज आवश्यक/);
  const path = user + "/" + day + "/basic-leave.pdf";
  args[10] = path;
  await assert.rejects(basic(args), /अपलोड/);
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    path,
    user,
  ]);
  args[3] = "Wrong";
  await assert.rejects(basic(args), /नियुक्ति/);
  args[3] = "Department";
  const record = await basic(args);
  assert.equal(record.leave_path, path);
  assert.equal(record.time_in, null);
  assert.equal(record.leave_type, "CL");
  assert.equal(
    (
      await db.query("select consumed from pending_uploads where path=$1", [
        path,
      ])
    ).rows[0].consumed,
    true,
  );
});

test("workplace evidence RPC requires owned photo or absence reason, without GPS or browser binding", async () => {
  const ids = [
    "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ];
  for (let i = 0; i < ids.length; i++) {
    await db.query("insert into auth.users values($1)", [ids[i]]);
    await db.query(
      `insert into profiles(id,name,phone,login_email,assignments) values($1,$2,$3,$4,'[{"panchayat":"Office","department":"Department","position":"Staff"}]')`,
      [
        ids[i],
        "Evidence " + i,
        "910000000" + i,
        "evidence" + i + "@test.invalid",
      ],
    );
  }
  const evidence = async (args) =>
    (
      await db.query(
        "select save_attendance_with_evidence(" +
          args.map((_, i) => "$" + (i + 1)).join(",") +
          ") as record",
        args,
      )
    ).rows[0].record;
  const present = [
    ids[0],
    "save_draft",
    "Office",
    "Department",
    "Staff",
    "present",
    null,
    null,
    null,
    null,
  ];
  await assert.rejects(evidence(present), /फोटो आवश्यक/);
  present[9] = ids[0] + "/" + day + "/workplace.jpg";
  await assert.rejects(evidence(present), /अपलोड/);
  await db.query("insert into pending_uploads(path,staff_id) values($1,$2)", [
    present[9],
    ids[0],
  ]);
  const arrival = await evidence(present);
  assert.equal(arrival.photo_path, present[9]);
  assert.equal(arrival.latitude, null);
  assert.equal(arrival.phase, "draft");
  assert.ok(arrival.time_in);
  const completed = await evidence([
    ids[0],
    "complete",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.equal(completed.id, arrival.id);
  assert.ok(completed.time_out);
  const absent = [
    ids[1],
    "save_status",
    "Office",
    "Department",
    "Staff",
    "absent",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];
  await assert.rejects(evidence(absent), /अनुपस्थिति का कारण/);
  absent[19] = "   ";
  await assert.rejects(evidence(absent), /अनुपस्थिति का कारण/);
  absent[19] = "Family emergency";
  const saved = await evidence(absent);
  assert.equal(saved.absence_reason, "Family emergency");
  assert.equal(saved.time_in, null);
  assert.equal(saved.photo_path, null);
  await db.exec(
    `set role authenticated;set request.jwt.claim.sub='${users[4]}';`,
  );
  assert.equal(
    (
      await db.query("select absence_reason from attendance where id=$1", [
        saved.id,
      ])
    ).rows[0].absence_reason,
    "Family emergency",
  );
  await assert.rejects(evidence(absent), /permission denied/);
  await db.exec("reset role");
});
