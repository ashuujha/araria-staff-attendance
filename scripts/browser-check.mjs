import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.TEST_URL || "http://localhost:3000");
await page
  .getByRole("heading", { name: "आज की उपस्थिति", exact: true })
  .waitFor();
await mkdir("test-results", { recursive: true });
await page.screenshot({
  path: "test-results/dashboard-desktop.png",
  fullPage: true,
});
await page
  .getByRole("textbox", { name: "कर्मी खोजें" })
  .fill("उदाहरण कर्मी 01");
if ((await page.locator("tbody tr").count()) !== 1)
  throw Error("Search failed");
await page.getByRole("textbox", { name: "कर्मी खोजें" }).fill("");
await page.getByRole("button", { name: "रात्रि मोड" }).click();
if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
  throw Error("Theme failed");
await page.reload();
await page.waitForFunction(
  () => document.documentElement.dataset.theme === "dark",
);
if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
  throw Error("Theme persistence failed");
await page.getByRole("button", { name: "दिन मोड" }).click();
await page.getByRole("button", { name: /मेरी उपस्थिति/ }).click();
await page.getByRole("heading", { name: "मेरी दैनिक उपस्थिति" }).waitFor();
if (await page.locator("input[type=file]").count())
  throw Error("Gallery input exposed before leave");
await page.getByRole("checkbox", { name: /अवकाश पर हूँ/ }).check();
await page.locator("input[type=file]").waitFor();
await page.getByRole("checkbox", { name: /अवकाश पर हूँ/ }).uncheck();
await page.getByRole("button", { name: /अवलोकन/ }).click();
const download = page.waitForEvent("download");
await page.getByRole("button", { name: /निर्यात/ }).click();
await (await download).saveAs("test-results/export.csv");
await page.setViewportSize({ width: 390, height: 844 });
if (
  await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
)
  throw Error("Mobile overflow");
await page.screenshot({
  path: "test-results/dashboard-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "मेनू खोलें" }).click();
await page.getByRole("button", { name: "गूगल शीट", exact: true }).click();
await page.getByRole("heading", { name: "गूगल शीट समन्वयन" }).waitFor();
await page.getByRole("button", { name: /सेटअप निर्देश/ }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("button", { name: "बंद करें", exact: true }).click();
await page.getByRole("button", { name: "English", exact: true }).click();
await page
  .getByRole("heading", { name: "Google Sheets sync", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Open menu", exact: true }).click();
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page
  .getByRole("heading", { name: "Attendance overview", exact: true })
  .waitFor();
await page
  .getByRole("textbox", { name: "Search staff", exact: true })
  .fill("Sample staff 01");
if ((await page.locator("tbody tr").count()) !== 1)
  throw Error("English search failed");
await page.getByRole("textbox", { name: "Search staff", exact: true }).fill("");
const select = page.getByRole("combobox", {
  name: "Filter by panchayat",
  exact: true,
});
await select.selectOption({ label: "Pokharia" });
if ((await select.inputValue()) !== "पोखरिया")
  throw Error("Translation changed canonical panchayat value");
await select.selectOption("all");
await page.reload();
await page
  .getByRole("heading", { name: "Attendance overview", exact: true })
  .waitFor();
if ((await page.locator("html").getAttribute("lang")) !== "en")
  throw Error("Language persistence failed");
await page.screenshot({
  path: "test-results/dashboard-mobile-en.png",
  fullPage: true,
});
await page.setViewportSize({ width: 1440, height: 1100 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: "test-results/dashboard-desktop-en.png",
  fullPage: true,
});
await page.getByRole("button", { name: "My attendance", exact: true }).click();
await page
  .getByRole("heading", { name: "My daily attendance", exact: true })
  .waitFor();
await page
  .getByRole("checkbox", { name: "I am on leave (CL / SL)", exact: true })
  .check();
await page.getByText("Upload CL / SL documentation", { exact: true }).waitFor();
await page
  .getByRole("checkbox", { name: "I am on leave (CL / SL)", exact: true })
  .uncheck();
await page.getByRole("button", { name: "Punch in", exact: true }).click();
await page
  .getByRole("status")
  .getByText("This is a preview. Sign in to record actual attendance.", {
    exact: true,
  })
  .waitFor();
await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.getByRole("button", { name: "Staff help", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("heading", { name: "Staff help", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.getByRole("button", { name: "हिन्दी", exact: true }).click();
await page
  .getByRole("heading", { name: "सेटिंग्स एवं सहायता", exact: true })
  .waitFor();
await page.getByRole("button", { name: "कर्मी प्रबंधन", exact: true }).click();
await page
  .getByRole("heading", { name: "मास्टर डेटा — कर्मी", exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "नया कर्मी जोड़ें", exact: true })
  .click();
const masterDialog = page.getByRole("dialog");
await masterDialog.getByLabel("नाम", { exact: true }).fill("उदाहरण नया कर्मी");
await masterDialog.getByLabel("मोबाइल", { exact: true }).fill("9000001234");
await masterDialog
  .getByRole("checkbox", { name: "पोखरिया", exact: true })
  .check();
await masterDialog
  .getByRole("checkbox", { name: "अररिया बस्ती", exact: true })
  .check();
for (const place of ["पोखरिया", "अररिया बस्ती"])
  await masterDialog
    .locator(`input[name="position:${place}"]`)
    .fill("पंचायत सचिव");
await masterDialog
  .getByLabel("बदलाव का कारण", { exact: true })
  .fill("उदाहरण मास्टर डेटा परीक्षण");
await masterDialog
  .getByRole("button", { name: "कर्मी जोड़ें", exact: true })
  .click();
await page
  .getByRole("status")
  .getByText("वास्तविक बदलाव के लिए एडमिन लॉगिन करें।", { exact: true })
  .waitFor();
await masterDialog
  .getByRole("button", { name: "बंद करें", exact: true })
  .click();
await page
  .locator(".master-row")
  .first()
  .getByRole("button", { name: "हटाएँ", exact: true })
  .click();
await page.getByRole("heading", { name: "कर्मी हटाएँ", exact: true }).waitFor();
await page
  .getByRole("dialog")
  .getByLabel("हटाने का कारण", { exact: true })
  .fill("उदाहरण हटाने का परीक्षण");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "हटाने की पुष्टि करें", exact: true })
  .click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "बंद करें", exact: true })
  .click();
await page.getByRole("button", { name: "English", exact: true }).click();
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page
  .getByRole("button", { name: "Enter attendance", exact: true })
  .click();
const attendanceDialog = page.getByRole("dialog");
await attendanceDialog
  .getByRole("combobox", { name: "Select staff member", exact: true })
  .selectOption("sample-1");
await attendanceDialog
  .getByText("The same data will appear at all these worksites", {
    exact: true,
  })
  .waitFor();
if (
  (await attendanceDialog
    .getByRole("combobox", { name: "Recording worksite", exact: true })
    .locator("option")
    .count()) !== 3
)
  throw Error("Assigned workplaces missing from admin entry");
await attendanceDialog
  .getByLabel("Reason for manual attendance", { exact: true })
  .fill("Preview attendance entry test");
await attendanceDialog
  .getByRole("button", { name: "Save attendance", exact: true })
  .click();
await attendanceDialog
  .getByRole("button", { name: "Close", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "Search staff", exact: true })
  .fill("Sample staff 02");
for (const place of ["Pokharia", "Araria Basti", "Basantpur"]) {
  await page
    .getByRole("combobox", { name: "Filter by panchayat", exact: true })
    .selectOption({ label: place });
  if ((await page.locator("tbody tr").count()) !== 1)
    throw Error("Shared record missing for " + place);
  await page
    .locator("tbody tr")
    .getByText("09:06 AM", { exact: true })
    .waitFor();
}
await page
  .getByRole("combobox", { name: "Filter by panchayat", exact: true })
  .selectOption("all");
await page.getByRole("textbox", { name: "Search staff", exact: true }).fill("");
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "PASS: search, theme persistence, live-camera-only form, leave upload, CSV export, mobile layout/navigation, English/Hindi switching and persistence, English forms/messages, canonical dropdown values, admin master-data forms, delete confirmations and shared workplace attendance.",
);
await browser.close();
