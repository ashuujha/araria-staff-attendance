import { createSign } from "node:crypto";
import { sb, HttpError } from "./server";
import { planSheetRows } from "./reporting.mjs";
import { safeSheetCell } from "./security.mjs";
import type { Attendance, Profile } from "./types";
const columns = [
  "S.No",
  "Date",
  "Panchayat",
  "कर्मी का नाम",
  "Position",
  "Department",
  "Phone",
  "GPS Photograph (link)",
  "Latitude",
  "Longitude",
  "Location Accuracy (m)",
  "Map Link",
  "CL/SL Document (link)",
  "Time In",
  "Time Out",
  "Status Flags",
  "Record ID",
];
function encode(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}
async function accessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key || !process.env.GOOGLE_SHEET_ID)
    throw new HttpError(503, "Google Sheets सेटअप बाकी है।");
  const now = Math.floor(Date.now() / 1000);
  const content =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signature = createSign("RSA-SHA256")
    .update(content)
    .sign(key.replaceAll("\\n", "\n"))
    .toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: content + "." + signature,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("Google authentication failed");
  return (await r.json()).access_token;
}
export async function syncOne() {
  const job = await sb("/rest/v1/rpc/claim_sync_job", {
    method: "POST",
    body: "{}",
  });
  if (!job) return { synced: 0 };
  try {
    const token = await accessToken();
    async function google(path: string, method = "GET", body?: unknown) {
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}${path}`,
        {
          method,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok) throw Error("Google Sheets request failed: " + r.status);
      return r.json();
    }
    const records = await sb(
      "/rest/v1/attendance?id=eq." + job.record_id + "&select=*",
    );
    const a: Attendance = records[0];
    const profiles = await sb(
      "/rest/v1/profiles?id=eq." +
        a.staff_id +
        "&select=name,phone,assignments",
    );
    const p: Profile = profiles[0];
    const date = new Date(a.date + "T00:00:00Z");
    const tab = new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(date)
      .replace(" ", "-");
    const metadata = await google("?fields=sheets.properties");
    let sheet = metadata.sheets.find(
      (s: { properties: { title: string } }) => s.properties.title === tab,
    );
    if (!sheet) {
      const added = await google(":batchUpdate", "POST", {
        requests: [{ addSheet: { properties: { title: tab } } }],
      });
      sheet = added.replies[0].addSheet;
      await google(
        "/values/" +
          encodeURIComponent(`'${tab}'!A1:Q1`) +
          "?valueInputOption=RAW",
        "PUT",
        { values: [columns] },
      );
      await google(":batchUpdate", "POST", {
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: "COLUMNS",
                startIndex: 16,
                endIndex: 17,
              },
              properties: { hiddenByUser: true },
              fields: "hiddenByUser",
            },
          },
          {
            addProtectedRange: {
              protectedRange: {
                range: { sheetId: sheet.properties.sheetId },
                description: "Attendance service-account mirror",
                warningOnly: false,
                editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL] },
              },
            },
          },
        ],
      });
    }
    const ids = await google("/values/" + encodeURIComponent(`'${tab}'!Q2:Q`));
    const plan = planSheetRows(a, p, ids.values || []);
    const fileUrl = (kind: string) =>
      `${process.env.APP_URL}/api/files?id=${a.id}&kind=${kind}`;
    const time = (t: string | null) =>
      t
        ? new Date(t).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
    const data = plan.writes.map(
      ({
        row,
        key,
        assignment,
      }: {
        row: number;
        key: string;
        assignment: { panchayat: string; position: string; department: string };
      }) => ({
        range: `'${tab}'!A${row}:Q${row}`,
        values: [
          [
            row - 1,
            a.date.split("-").reverse().join("/"),
            assignment.panchayat,
            p.name,
            assignment.position,
            assignment.department,
            p.phone,
            a.photo_path ? fileUrl("photo_path") : "",
            a.latitude,
            a.longitude,
            a.accuracy,
            a.latitude == null
              ? ""
              : `https://www.google.com/maps?q=${a.latitude},${a.longitude}`,
            a.leave_path ? fileUrl("leave_path") : "",
            time(a.time_in),
            time(a.time_out),
            a.flags.join(", "),
            key,
          ].map(safeSheetCell),
        ],
      }),
    );
    for (const row of plan.clearRows)
      data.push({
        range: `'${tab}'!A${row}:Q${row}`,
        values: [Array(17).fill("")],
      });
    if (data.length)
      await google("/values:batchUpdate", "POST", {
        valueInputOption: "RAW",
        data,
      });
    await sb("/rest/v1/rpc/finish_sync_job", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.record_id,
        job_version: job.version,
        error_text: null,
      }),
    });
    return { synced: 1 };
  } catch (e) {
    await sb("/rest/v1/rpc/finish_sync_job", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.record_id,
        job_version: job.version,
        error_text: e instanceof Error ? e.message : "Sync failed",
      }),
    });
    throw e;
  }
}
