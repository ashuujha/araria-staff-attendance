// Browser-only fixtures: no demonstration records are shipped to production.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.TEST_URL || "http://localhost:3000";
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const assignment = {
  department: "पंचायती राज विभाग",
  panchayat: "Pokharia",
  position: "Panchayat Secretary",
};
const staff = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Browser Staff One",
    phone: "9000000001",
    email: null,
    role: "staff",
    block: "Araria",
    active: true,
    assignments: [assignment],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Browser Staff Two",
    phone: "9000000002",
    email: null,
    role: "staff",
    block: "Araria",
    active: true,
    assignments: [assignment],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Browser Staff Three",
    phone: "9000000003",
    email: null,
    role: "staff",
    block: "Araria",
    active: true,
    assignments: [assignment],
  },
];
const admin = {
  ...staff[0],
  id: "00000000-0000-4000-8000-000000000004",
  role: "super_admin",
  name: "Browser Administrator",
  email: "browser-admin@example.test",
};
let session = null;
let record = null;
const loginBodies = [];
const workflowBodies = [];
const adminDates = [];
const addressRequests = [];
const absent = {
  id: "absent-record",
  staff_id: staff[1].id,
  date,
  ...assignment,
  block: "Araria",
  status: "absent",
  phase: "submitted",
  time_in: null,
  time_out: null,
  profiles: staff[1],
  flags: [],
};
const startupReads = [];
const initialDashboard = () => ({
  profile: session,
  date,
  records:
    session?.role === "staff"
      ? record && record.staff_id === session.id
        ? [record]
        : []
      : [...(record ? [record] : []), absent],
  staff: session?.role === "staff" ? [] : staff,
  office: { today: date, holidays: [], notices: [] },
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: [],
});
// Browser-only CAPTCHA fixture; the production endpoint still validates tokens.
await context.route(
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = {
 render(element, options) { const id='fixture-'+Math.random(); const label=document.createElement('label'); const box=document.createElement('input'); box.type='checkbox'; label.append(box,document.createTextNode('Browser CAPTCHA check')); element.id=id; element.append(label); box.onchange=()=>options.callback(box.checked?'fixture-token':''); return id; },
 remove(id) { const element=document.getElementById(id); if(element) element.replaceChildren(); }
};`,
    }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const body = request.method() === "POST" ? request.postDataJSON() : null;
  const respond = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (
    ["/api/location", "/api/location-map", "/api/attendance"].includes(
      url.pathname,
    )
  ) {
    addressRequests.push(url.pathname);
    throw Error("Camera/GPS API must not be requested during onboarding");
  }
  if (url.pathname === "/api/panchayats")
    return respond({
      panchayats: [{ name: assignment.panchayat, block: "Araria" }],
    });
  if (url.pathname === "/api/staff") {
    if (body.action === "create") {
      const person = {
        id: "00000000-0000-4000-8000-000000000009",
        name: body.name,
        phone: body.phone,
        email: body.email,
        assignments: body.assignments,
        block: "Araria",
        role: "staff",
        active: true,
      };
      staff.push(person);
      return respond({ profile: person, password: "fixture-new-password" });
    }
    const index = staff.findIndex((p) => p.id === body.id);
    if (body.action === "update") {
      staff[index] = { ...staff[index], ...body.changes };
      return respond({ profile: staff[index] });
    }
    if (body.action === "delete") {
      staff.splice(index, 1);
      return respond({ success: true });
    }
  }
  if (
    ["/api/office", "/api/admin", "/api/attendance-workflow"].includes(
      url.pathname,
    ) &&
    request.method() === "GET"
  )
    startupReads.push(url.pathname);
  if (url.pathname === "/api/office")
    return respond({ holidays: [], notices: [], today: date });
  if (url.pathname === "/api/auth/captcha")
    return respond({
      siteKey: "browser-fixture-site",
      challenge: "browser-fixture-challenge",
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    });
  if (url.pathname === "/api/session")
    return respond(
      session
        ? { profile: session, bootstrap: initialDashboard() }
        : { error: "Please log in." },
      session ? 200 : 401,
    );
  if (url.pathname === "/api/auth/login") {
    loginBodies.push(body);
    if (body.password === "wrong-password")
      return respond({ error: "Browser test: incorrect password" }, 401);
    session = body.admin === true ? admin : staff[0];
    return respond({ profile: session, bootstrap: initialDashboard() });
  }
  if (url.pathname === "/api/auth/logout") {
    session = null;
    return respond({ success: true });
  }
  if (url.pathname === "/api/attendance-workflow") {
    if (request.method() === "GET")
      return respond({ records: record ? [record] : [] });
    workflowBodies.push(body);
    if (body.action === "complete") {
      assert.ok(record, "Checkout requires an existing arrival");
      record = {
        ...record,
        phase: "submitted",
        time_out: `${date}T11:30:00.000Z`,
      };
    } else {
      record = {
        id: "arrival-record",
        staff_id: staff[0].id,
        date,
        ...assignment,
        block: "Araria",
        status: body.status,
        phase: body.action === "save_draft" ? "draft" : "submitted",
        time_in: body.action === "save_draft" ? `${date}T03:45:00.000Z` : null,
        time_out: null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        accuracy: body.accuracy ?? null,
        photo_path: body.photo_upload_path ?? null,
        leave_path: body.leave_upload_path ?? null,
        deputation_workplace: body.deputation_workplace ?? null,
        leave_type: body.leave_type ?? null,
        absence_reason: body.absence_reason ?? null,
        profiles: staff[0],
        flags: [],
      };
    }
    return respond({ record });
  }
  if (url.pathname === "/api/upload")
    return respond({
      path: `${staff[0].id}/${date}/browser-photo.jpg`,
      url: new URL("/__browser_upload", baseUrl).href,
    });
  if (url.pathname === "/api/admin") {
    adminDates.push(url.searchParams.get("date"));
    return respond({ staff, records: [...(record ? [record] : []), absent] });
  }
  if (url.pathname === "/api/files")
    return respond({ url: new URL("/__private_document", baseUrl).href });
  throw Error(
    `Unexpected browser API request: ${request.method()} ${url.pathname}`,
  );
});
await context.route("**/__browser_upload", async (route) => {
  return route.fulfill({ status: 200, body: "{}" });
});
await mkdir("test-results", { recursive: true });
const visible = async (locator) =>
  assert.ok(await locator.isVisible(), `Expected visible: ${locator}`);
const screenshot = async (name) =>
  page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile horizontal overflow",
  );
const responsiveSweep = async (name) => {
  const original = page.viewportSize();
  for (const width of [
    320, 360, 390, 480, 600, 768, 820, 1024, 1366, 1920, 2560, 3840,
  ]) {
    await page.setViewportSize({ width, height: width >= 1920 ? 1440 : 1000 });
    await noOverflow();
    const clipped = await page
      .locator(
        ".sp-header button, .sp-title-actions button, .sp-table button, .sp-field input, .sp-field select",
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              (rect.left < -1 || rect.right > window.innerWidth + 1)
            );
          })
          .map((element) => element.textContent || element.tagName),
      );
    assert.deepEqual(clipped, [], `${name} clipped controls at ${width}px`);
    if ([390, 768, 1366, 1920, 3840].includes(width))
      await screenshot(`${name}-${width}`);
  }
  await page.setViewportSize(original);
};
try {
  await page.goto(baseUrl);
  // UI regression steps are kept below so route fixtures stay independent of styling.
  await page
    .getByRole("heading", { name: "कर्मी लॉगिन / Staff login", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("table").count(),
    0,
    "Public staff directory exposed",
  );
  assert.equal(
    await page.getByText(staff[0].name, { exact: true }).count(),
    0,
    "Staff data exposed while logged out",
  );
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Sample staff|उदाहरण कर्मी|preview/i,
  );
  await responsiveSweep("login-responsive");
  await screenshot("login-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screenshot("login-mobile");
  await page.goto(baseUrl + "/admin");
  await page.locator("#admin-captcha-code").fill("ABC234");
  await page
    .getByRole("checkbox", { name: "Browser CAPTCHA check", exact: true })
    .check();
  await page
    .getByLabel("ईमेल या मोबाइल / Email or mobile", { exact: true })
    .fill(admin.email);
  await page
    .getByLabel("पासवर्ड / Password", { exact: true })
    .fill("wrong-password");
  await page
    .getByRole("button", { name: "लॉगिन / Login", exact: true })
    .click();
  await page
    .getByRole("alert")
    .getByText("Browser test: incorrect password", { exact: true })
    .waitFor();
  assert.equal(
    loginBodies.at(-1).admin,
    true,
    "Admin role omitted from login request",
  );
  await page.goto(baseUrl);
  await page
    .getByLabel("मोबाइल नंबर / Mobile number", { exact: true })
    .fill(staff[0].phone);
  await page
    .getByLabel("पासवर्ड / Password", { exact: true })
    .fill("browser-password");
  await page
    .getByRole("button", { name: "लॉगिन / Login", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "आज की उपस्थिति", exact: true })
    .waitFor();
  assert.equal(loginBodies.at(-1).admin, false);
  assert.equal(
    startupReads.length,
    0,
    "Fast login should not refetch initial attendance or office data",
  );
  await visible(page.getByText(staff[0].name, { exact: true }).last());
  assert.equal(
    await page.getByText(staff[1].name, { exact: true }).count(),
    0,
    "Other staff exposed to staff account",
  );
  assert.equal(
    await page.getByRole("tab").count(),
    0,
    "Staff received admin dashboard",
  );
  for (const [label, value] of [
    ["पंचायत / Panchayat", assignment.panchayat],
    ["पद / Position", assignment.position],
  ])
    assert.equal(
      await page.getByLabel(label, { exact: true }).inputValue(),
      value,
    );
  const status = page.getByLabel("कार्य स्थिति / Work status", { exact: true });
  await status.selectOption("leave");
  const fileInput = page.locator('input[type="file"]');
  assert.match(await fileInput.getAttribute("accept"), /image\/jpeg/);
  assert.match(await fileInput.getAttribute("accept"), /application\/pdf/);
  assert.equal(
    await fileInput.getAttribute("required"),
    "",
    "Leave documentation is required",
  );
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Save status/ }).click();
  assert.equal(workflowBodies.length, 0, "Missing leave document accepted");
  await fileInput.setInputFiles({
    name: "oversized.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(5 * 1024 * 1024),
  });
  assert.equal(
    await fileInput.evaluate((input) => input.files.length),
    0,
    "5 MiB document must be rejected",
  );
  await fileInput.setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  assert.equal(
    await fileInput.evaluate((input) => input.files.length),
    0,
    "Empty leave document accepted",
  );
  await fileInput.setInputFiles({
    name: "leave.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 browser test document"),
  });
  await status.selectOption("deputation");
  const workplace = page.getByLabel(
    "प्रतिनियुक्ति कार्यस्थल का नाम / Workplace name",
    { exact: true },
  );
  assert.equal(await workplace.getAttribute("required"), "");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Save arrival draft/ }).click();
  assert.equal(workflowBodies.length, 0, "Blank deputation workplace accepted");
  await workplace.fill("District office");
  const ordinaryPhoto = page.getByLabel("कार्यस्थल की फोटो / Workplace photo", {
    exact: true,
  });
  await ordinaryPhoto.setInputFiles({
    name: "workplace.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#456789" },
    })
      .png()
      .toBuffer(),
  });

  assert.equal(await page.locator("video").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: /Take GPS photo|Get current location/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: /Save arrival draft/ }).click();
  await page
    .getByRole("heading", { name: "आज की सहेजी गई जानकारी", exact: true })
    .waitFor();
  assert.equal(workflowBodies[0].action, "save_draft");
  assert.equal(workflowBodies[0].deputation_workplace, "District office");
  for (const field of ["latitude", "longitude", "accuracy", "challenge"])
    assert.equal(workflowBodies[0][field], undefined);
  assert.ok(workflowBodies[0].photo_upload_path);
  assert.equal(addressRequests.length, 0);
  assert.equal(
    workflowBodies[0].time_in,
    undefined,
    "Client must not supply arrival time",
  );
  assert.equal(record.time_out, null);
  await visible(page.getByText("09:15 am", { exact: true }));
  await noOverflow();
  await responsiveSweep("staff-responsive");
  await screenshot("staff-draft-mobile");
  await page.reload();
  await page.getByRole("button", { name: /Save out time & finish/ }).waitFor();
  await visible(page.getByText("09:15 am", { exact: true }));
  session = admin;
  await page.reload();
  await page
    .getByRole("heading", { name: "कर्मी और उपस्थिति", exact: true })
    .waitFor();
  await page.locator("tbody tr").first().waitFor();
  assert.equal(
    await page.locator("tbody tr").count(),
    2,
    "Recorded absent and draft must remain distinct from unrecorded staff",
  );
  await visible(page.getByText("कार्यस्थल पर • Draft", { exact: true }));
  const search = page.getByLabel("कर्मी खोजें / Search staff", { exact: true });
  await search.fill("9000000001");
  assert.equal(await page.locator("tbody tr").count(), 1);
  for (const [label, value] of [
    ["प्रखंड / Block", "Araria"],
    ["पंचायत / Panchayat", assignment.panchayat],
    ["पद / Position", assignment.position],
    ["स्थिति / Status", "deputation"],
    ["ड्राफ़्ट / पूर्ण", "draft"],
  ])
    await page.getByLabel(label, { exact: true }).selectOption(value);
  assert.equal(
    await page.locator("tbody tr").count(),
    1,
    "Combined admin filters lost matching arrival",
  );
  await page
    .getByLabel("स्थिति / Status", { exact: true })
    .selectOption("absent");
  assert.equal(
    await page.locator("tbody tr").count(),
    0,
    "Combined status filter ignored",
  );
  await page
    .getByLabel("स्थिति / Status", { exact: true })
    .selectOption("deputation");
  await page
    .getByRole("button", { name: `${staff[0].name} का विवरण`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await visible(dialog.getByText("District office", { exact: true }));
  assert.equal(
    await dialog
      .getByRole("button", { name: "GPS फोटो देखें", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await dialog
      .getByRole("link", { name: /Open staff location|View location/ })
      .count(),
    0,
  );
  await dialog
    .getByRole("button", { name: "बंद करें / Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "फ़िल्टर हटाएँ / Clear filters", exact: true })
    .click();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dateRequest = page.waitForResponse((response) =>
    response.url().includes(`/api/admin?date=${yesterday}`),
  );
  await page.getByLabel("तारीख / Date", { exact: true }).fill(yesterday);
  await dateRequest;
  assert.ok(
    adminDates.includes(yesterday),
    "Date filter was not sent to server",
  );
  const todayRequest = page.waitForResponse((response) =>
    response.url().includes(`/api/admin?date=${date}`),
  );
  await page.getByLabel("तारीख / Date", { exact: true }).fill(date);
  await todayRequest;
  await page
    .getByRole("tab", { name: "सभी कर्मी / Staff directory", exact: true })
    .click();
  await page.locator("tbody tr").first().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3);
  await search.fill("Browser Staff Three");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await visible(page.getByText("दर्ज नहीं / Not recorded", { exact: true }));
  await page
    .getByRole("button", { name: `${staff[2].name} का विवरण`, exact: true })
    .click();
  await visible(dialog.getByText(staff[2].phone, { exact: true }));
  await dialog
    .getByRole("button", { name: "बंद करें / Close", exact: true })
    .click();
  await search.fill("");
  await noOverflow();
  await responsiveSweep("directory-responsive");
  await screenshot("admin-mobile");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await screenshot("admin-desktop");
  session = staff[0];
  await page.reload();
  await page.getByRole("button", { name: /Save out time & finish/ }).click();
  await page
    .getByText("आज की उपस्थिति पूरी हो गई है।", { exact: true })
    .waitFor();
  assert.equal(workflowBodies.at(-1).action, "complete");
  assert.equal(
    workflowBodies.at(-1).id,
    "arrival-record",
    "Checkout changed record identity",
  );
  assert.equal(
    workflowBodies.at(-1).time_out,
    undefined,
    "Client must not supply checkout time",
  );
  await visible(page.getByText("05:00 pm", { exact: true }));
  await screenshot("staff-completed-desktop");
  session = admin;
  await page.reload();
  await page
    .getByRole("heading", { name: "कर्मी और उपस्थिति", exact: true })
    .waitFor();
  await page.locator("tbody tr").first().waitFor();
  await page
    .getByLabel("ड्राफ़्ट / पूर्ण", { exact: true })
    .selectOption("completed");
  assert.equal(
    await page.locator("tbody tr").count(),
    2,
    "Saved filter omitted server submitted records",
  );
  await page
    .getByRole("tab", { name: "सभी कर्मी / Staff directory", exact: true })
    .click();
  await page
    .getByRole("button", { name: "कर्मी जोड़ें / Add staff", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "कर्मी जोड़ें / Add staff",
    exact: true,
  });
  await editor
    .getByLabel("नाम / Name", { exact: true })
    .fill("Browser New Staff");
  await editor
    .getByLabel("मोबाइल नंबर / Mobile number", { exact: true })
    .fill("9000000009");
  await editor
    .getByLabel("पंचायत / Panchayat", { exact: true })
    .selectOption(assignment.panchayat);
  await editor
    .getByLabel("पद / Position", { exact: true })
    .fill(assignment.position);

  await editor
    .getByRole("button", { name: "सहेजें / Save", exact: true })
    .click();
  await editor.getByText("fixture-new-password", { exact: true }).waitFor();
  await editor
    .getByRole("button", { name: "बंद करें / Close", exact: true })
    .click();
  const newRow = page
    .locator("tbody tr")
    .filter({ hasText: "Browser New Staff" });
  await newRow
    .getByRole("button", { name: "बदलें / Edit", exact: true })
    .click();
  const editDialog = page.getByRole("dialog", {
    name: "कर्मी विवरण बदलें / Edit staff",
    exact: true,
  });
  await editDialog
    .getByLabel("नाम / Name", { exact: true })
    .fill("Browser Edited Staff");

  await editDialog
    .getByRole("button", { name: "सहेजें / Save", exact: true })
    .click();
  const editedRow = page
    .locator("tbody tr")
    .filter({ hasText: "Browser Edited Staff" });
  await editedRow
    .getByRole("button", { name: "हटाएँ / Remove", exact: true })
    .click();
  const removeDialog = page.getByRole("dialog", {
    name: "कर्मी हटाएँ / Remove staff",
    exact: true,
  });

  await removeDialog
    .getByRole("button", {
      name: "हटाने की पुष्टि / Confirm removal",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("tbody")
        ?.textContent.includes("Browser Edited Staff"),
  );
  assert.deepEqual(errors, [], "Browser page errors");
  console.log(
    "PASS: private login, role selection, login error, assigned staff fields, required PDF/JPG leave document, deputation validation, draft without camera/GPS, server arrival time, reload, same-record checkout, admin search/date/combined filters, absent vs unrecorded directory, hidden GPS/photo and device reset controls, mobile overflow and screenshots; mocked APIs only.",
  );
} finally {
  await browser.close();
}
