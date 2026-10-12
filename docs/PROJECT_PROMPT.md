# PROJECT: Araria District Staff Attendance Survey Portal

**(अररिया जिला कर्मी उपस्थिति सर्वेक्षण पोर्टल)**

---

## 1. OVERVIEW

Build a secure, responsive web app (mobile + laptop) where ~395 Panchayati Raj and related staff of Araria District, Bihar, record daily attendance with GPS photo, real-time location, CL/SL proof, Time In and Time Out. Admins monitor everything on a dashboard, and all data is mirrored live to a Google Sheet.

**Coverage:** 30 Gram Panchayats + the Block Panchayati Raj Office, Araria.

**Panchayats:** पोखरिया, अररिया बस्ती, बसंतपुर, बाँसबाड़ी, हड़िया, हयातपुर, रामपुर कोदरकट्टी, चातर, कुसियारगाँव, गैड़ा, चिकनी, पैकटोला, झमटा, बोची, मदनपुर पूर्वी, चंद्रदेई, कमलदाहा, बनगामा, बेलवा, गैयारी, दियारी, जमुआ, तरौना भोजपुर, शरणपुर, किस्मत खवासपुर, बटुरबाड़ी, साहसमल, रामपुर मोहनपुर पूर्वी, रामपुर मोहनपुर पश्चिम, मदनपुर पश्चिम, plus "प्रखंड पंचायत राज कार्यालय, अररिया".

---

## 2. TECH STACK

- Next.js (App Router) + TypeScript + Tailwind
- PostgreSQL via Supabase (Auth, Storage, Row Level Security)
- Background job queue for Google Sheets sync
- Deployed on Vercel/Supabase or a VPS, HTTPS only
- UI labels bilingual: Hindi first, English second

---

## 3. DESIGN RULES

- Simple, flat, minimal. **NO gradients**, no glossy or "AI-style" visuals, no decorative animation.
- Eye-soothing muted palette (off-white/soft grey for day, dark charcoal for night). **Day/Night toggle** in the header, choice remembered.
- Large tap targets, readable fonts (Noto Sans / Noto Sans Devanagari), minimal fields, one-screen staff form.
- Fast on low-end Android phones and weak 3G/4G networks: small bundle, compressed images, loading states, clear offline/error messages.
- Fully responsive: card layout on mobile, table layout on laptop.

---

## 4. STAFF DATA MODEL AND LOGIN

Staff list comes from my uploaded Excel/CSV (~395 rows) with columns: Panchayat, Position, Department, Name, Mobile, Email.

**Rules**

- Login with **phone number OR email + password**.
- Each staff profile stores 5 fields: Panchayat (पंचायत), Position (पद), Department (विभाग), Name (नाम), Phone/Email.
- One staff member can cover multiple panchayats (e.g., one पंचायत सचिव or तकनीकी सहायक serves 3-5 panchayats; some rows have 2 phone numbers). Create **ONE account per unique phone number**, link it to all its assigned panchayats, and show a dropdown of only those panchayats on the form. Store secondary phone numbers.
- Skip vacancy rows (blank or "-" names). Rows with no phone and no email go into an admin **"Needs Fix"** list.
- **Positions:** मुखियाजी, पंचायत सचिव, लेखापाल, तकनीकी सहायक, पंचायत कार्यपालक सहायक, कचहरी सचिव, न्याय मित्र, विकास मित्र, ग्रामीण आवास सहायक, किसान सलाहकार, कृषि समन्वयक, पंचायत रोजगार सेवक, स्वच्छता पर्यवेक्षक (L.S.B.A), प्रखंड कार्य सहायक, डाटा एंट्री ऑपरेटर.
- **Departments:** पंचायती राज विभाग, कल्याण विभाग, ग्रामीण विकास विभाग, कृषि विभाग.
- **Passwords:** auto-generated in a fixed pattern `Araria@` + last 4 digits of phone + `#26`, bcrypt-hashed. Admin can export a credentials sheet (one-time) and reset any password. Optional toggle: force password change on first login.

---

## 5. STAFF DAILY FORM

Name, position, department are auto-filled and read-only.

1. **Date:** server date, not editable.
2. **Panchayat:** pre-filled or dropdown of assigned panchayats.
3. **GPS Photograph:** live camera capture ONLY (no gallery), with timestamp + latitude/longitude watermark burned into the image. Compress to ~300-500 KB.
4. **Real-time Location:** auto-captured lat/long + accuracy using high-accuracy geolocation.
5. **CL/SL Photo/Document:** upload PDF/JPG/PNG (max 5 MB), optional, shown as an "On Leave" option. If leave is selected, Time In/Out and GPS photo are not required.
6. **Time In:** "Punch In" button (server time).
7. **Time Out:** "Punch Out" button (server time).

**Rules:** one In and one Out per staff per day; Time Out only after Time In; no edits after submission by staff; only admin can correct, with a mandatory reason and audit log. Show a clear success/failure screen after each punch.

---

## 6. ANTI-BYPASS AND SECURITY (maximum practical protection)

- Date and time come from the **SERVER only**, never the device clock.
- Block submission if location permission is denied, accuracy is worse than 50 m, or coordinates look spoofed (mock-location signals, impossible travel speed between punches, identical coordinates across many users).
- **Geofence:** store each panchayat's coordinates and radius (admin-editable, default 300 m); punches outside are flagged or blocked (admin setting).
- Photo must be from the live camera; check capture time; reject reused images (perceptual hash duplicate check).
- Log IP, user-agent, device fingerprint; bind each account to one registered device (admin can reset binding). Flag VPN/proxy IPs.
- bcrypt password hashing, rate limiting, brute-force lockout (5 failed attempts), httpOnly secure cookies/JWT, session timeout, CSRF protection, strict input validation, file type and size checks, malware scan on uploads, security headers (CSP, HSTS).
- **Row Level Security:** staff can only read/write their own records. Private storage buckets with signed, expiring URLs for photos and CL/SL files.
- Everything suspicious is flagged on the admin dashboard: outside geofence, low accuracy, duplicate photo, new device, VPN/proxy, odd punch time.

---

## 7. ADMIN LOGIN AND DASHBOARD

- Separate admin login with a unique admin password and optional 2FA/OTP.
- **Roles:** Super Admin (full), District Viewer (read-only), Block Admin (own block only).
- **Dashboard cards:** today's Present / Absent / On Leave / Punched In but not Out / Not yet punched, totals out of 395, with panchayat-wise breakdown.
- **Data table columns:** S.No, Date, Panchayat, Name, Position, Department, Phone, GPS photo thumbnail (click to enlarge), Latitude, Longitude, accuracy, map link, CL/SL file, Time In, Time Out, working hours, status flags.
- **Filters:** date/date range, panchayat, position, department, staff name/phone, status, flagged only. Date-wise and panchayat-wise views. Map view with all punch pins for a day.
- **Export** to Excel (.xlsx), CSV, PDF for any filter.
- **Staff management:** add/edit/deactivate staff, edit assigned panchayats, reset password, reset device binding, bulk import (.xlsx/.csv upload or Google Sheet link/ID) with preview and validation before saving.
- **Panchayat management:** edit coordinates and geofence radius.
- **Admin correction** of a record with reason; full audit log of every admin action (who, what, when, old and new value).
- **"Missing punch" report** listing staff who have not punched by a set time (default 11:00 AM).

---

## 8. GOOGLE SHEETS INTEGRATION (one-way live mirror)

- The database is the source of truth. The Google Sheet is an auto-updated mirror for reporting. Staff never get access to the sheet.
- Use a Google Cloud Service Account + Google Sheets API. Share the sheet only with the service account email. Credentials only in server `.env`.
- **Sheet columns (matching my template):**
  `S.No | Date | Panchayat | कर्मी का नाम | Position | Department | Phone | GPS Photograph (link) | Latitude | Longitude | Location Accuracy (m) | Map Link | CL/SL Document (link) | Time In | Time Out | Status Flags`
- On Punch In: append a row. On Punch Out: update the same row (match staff_id + date), never duplicate.
- Photos and CL/SL files stay in secure storage; the sheet receives permission-protected links, not public ones.
- Queue-based sync with retry and batching (stay under ~60 writes/min). If Sheets is down or rate-limited, the punch is still saved and syncs later. Never block staff because of Sheets.
- One tab per month (e.g., "Oct-2026") plus a "Summary" tab with daily present/absent counts by panchayat.
- Flagged rows highlighted in a muted colour. Ranges protected so only the service account can edit. Edits in the sheet do NOT flow back to the database.
- Admin dashboard: "Open Google Sheet" button, "Last synced" time, sync error log, "Re-sync all" for any date range.

---

## 9. NON-FUNCTIONAL REQUIREMENTS

- Handle 395 users punching within the same 15-minute window without slowdown.
- Daily automated database backup; retain data at least 1 year.
- Timezone fixed to Asia/Kolkata. Date format DD/MM/YYYY, 12-hour time display.
- Clear Hindi error messages (e.g., "लोकेशन चालू करें", "फोटो कैमरे से लें").
- Accessibility: good contrast in both themes, keyboard navigable on laptop.
- Privacy notice screen at first login explaining location and photo collection.

---

## 10. DELIVERABLES

Complete source code, database schema with RLS policies, staff import/seed script (with duplicate-phone merging and vacancy skipping), Google Sheets sync worker, `.env.example`, setup guide for Google Service Account and Supabase, deployment steps, an admin user guide and a staff user guide (Hindi), and a test checklist covering login, double-punch prevention, geofence failure, spoof flag, sheet sync retry, and export.

---

## 11. HOW TO WORK

Ask me for anything missing (panchayat coordinates, admin names, logo, final staff CSV) before assuming. Build in stages:

1. Auth + staff import
2. Staff form + punch logic
3. Security + flags
4. Admin dashboard
5. Google Sheets sync
6. Polish + testing
