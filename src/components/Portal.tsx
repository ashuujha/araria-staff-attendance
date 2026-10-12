"use client";
import { useEffect, useRef, useState } from "react";
import { demoRows, panchayats, positions } from "../lib/demo";
import type { Profile, Attendance } from "../lib/types";
type View =
  | "overview"
  | "attendance"
  | "staff"
  | "panchayats"
  | "reports"
  | "sheets"
  | "settings"
  | "punch";
type Row = (typeof demoRows)[number];
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    calendar:
      "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2 M7 14h2 M12 14h2 M7 18h2",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    file: "M14 2H4v20h16V8z M14 2v6h6 M8 12h8 M8 16h8",
    sheet: "M4 3h16v18H4z M4 9h16 M4 15h16 M10 9v12",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1",
    moon: "M21 12a9 9 0 1 1-9-9 7 7 0 0 0 9 9",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
    arrow: "M7 17L17 7 M7 7h10v10",
    download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
    search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    check: "M5 12l4 4L19 6",
    clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    alert: "M12 3L2 21h20z M12 9v5 M12 17v1",
    camera: "M8 5l2-3h4l2 3h5v16H3V5z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    lock: "M6 10V7a6 6 0 0 1 12 0v3 M4 10h16v12H4z M12 15v3",
    logout: "M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4",
    menu: "M3 6h18 M3 12h18 M3 18h18",
    upload: "M12 16V3 M7 8l5-5 5 5 M4 17v4h16v-4",
    refresh:
      "M21 3v6h-6 M3 21v-6h6 M4 9a8 8 0 0 1 14-4l3 4 M20 15a8 8 0 0 1-14 4l-3-4",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    help: "M9 9a3 3 0 1 1 4 3l-1 1v2 M12 18v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    close: "M6 6l12 12 M6 18L18 6",
    chevron: "M9 5l7 7-7 7",
    shield: "M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
const nav: [View, string, string, string][] = [
  ["overview", "grid", "अवलोकन", "Overview"],
  ["attendance", "calendar", "उपस्थिति", "Attendance"],
  ["staff", "users", "कर्मी प्रबंधन", "Staff directory"],
  ["panchayats", "pin", "पंचायतें", "Panchayats"],
  ["reports", "file", "रिपोर्ट", "Reports"],
  ["sheets", "sheet", "गूगल शीट", "Google Sheets"],
];
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function csv(rows: Row[]) {
  const fields = [
    "Name",
    "Panchayat",
    "Position",
    "Department",
    "Time In",
    "Time Out",
    "Status",
    "Flags",
  ];
  const lines = [
    fields,
    ...rows.map((r) => [
      r.name,
      r.panchayat,
      r.position,
      r.department,
      r.time_in || "",
      r.time_out || "",
      r.status,
      r.flag || "",
    ]),
  ];
  const blob = new Blob(
    [
      "\ufeff" +
        lines
          .map((r) =>
            r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
          )
          .join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8;" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `araria-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
export default function Portal() {
  const [preview, setPreview] = useState(true),
    [profile, setProfile] = useState<Profile | null>(null),
    [view, setView] = useState<View>("overview"),
    [theme, setTheme] = useState("light"),
    [themeReady, setThemeReady] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [panchayat, setPanchayat] = useState("all"),
    [status, setStatus] = useState("all"),
    [date, setDate] = useState(today()),
    [page, setPage] = useState(1),
    [modal, setModal] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [login, setLogin] = useState(false),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<Row[]>(demoRows),
    [online, setOnline] = useState(true),
    [consent, setConsent] = useState(false),
    [adminTab, setAdminTab] = useState(false),
    [directory, setDirectory] = useState<Profile[]>([]),
    [fences, setFences] = useState<
      Record<
        string,
        { latitude: number | null; longitude: number | null; radius: number }
      >
    >({});
  const [gps, setGps] = useState<GeolocationCoordinates | null>(null),
    [photo, setPhoto] = useState<Blob | null>(null),
    [photoUrl, setPhotoUrl] = useState(""),
    [camera, setCamera] = useState(false),
    [leave, setLeave] = useState(false),
    [leaveFile, setLeaveFile] = useState<File | null>(null),
    [assignment, setAssignment] = useState(""),
    [challenge, setChallenge] = useState<{
      id: string;
      expires_at: string;
      server_time: string;
    } | null>(null),
    [record, setRecord] = useState<Attendance | null>(null);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const notify = (message: string) => setNotice(message);
  useEffect(() => {
    const saved = localStorage.getItem("araria-theme") || "light";
    setTheme(saved);
    setThemeReady(true);
    setOnline(navigator.onLine);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.profile) {
          setProfile(s.profile);
          setPreview(false);
          setView(s.profile.role === "staff" ? "punch" : "overview");
          setConsent(false);
          setAssignment(s.profile.assignments[0]?.panchayat || "");
        }
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("araria-theme", theme);
  }, [theme, themeReady]);
  useEffect(() => {
    if (!preview && profile) {
      if (profile.role === "staff") {
        fetch("/api/attendance")
          .then((r) => r.json())
          .then((r) => setRecord(r.records?.[0] || null))
          .catch(() => notify("उपस्थिति लोड नहीं हुई। दोबारा कोशिश करें।"));
      } else {
        fetch("/api/admin?date=" + date)
          .then((r) => r.json())
          .then((r) => {
            if (r.error) throw Error(r.error);
            const mapped = (r.records || []).map((a: Attendance) => ({
              id: a.id,
              name: a.profiles?.name || "",
              panchayat: a.panchayat,
              position: a.profiles?.assignments[0]?.position || "",
              department: a.profiles?.assignments[0]?.department || "",
              phone: a.profiles?.phone || "",
              time_in: a.time_in
                ? new Date(a.time_in).toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null,
              time_out: a.time_out
                ? new Date(a.time_out).toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null,
              status: a.status,
              flag: a.flags.join(", ") || null,
              accuracy: a.accuracy || 0,
            }));
            const seen = new Set(
              (r.records || []).map((a: Attendance) => a.staff_id),
            );
            setRows([
              ...mapped,
              ...(r.staff || [])
                .filter((p: Profile) => !seen.has(p.id))
                .map((p: Profile) => ({
                  id: "absent-" + p.id,
                  name: p.name,
                  panchayat: p.assignments[0]?.panchayat || "",
                  position: p.assignments[0]?.position || "",
                  department: p.assignments[0]?.department || "",
                  phone: p.phone,
                  time_in: null,
                  time_out: null,
                  status: "absent",
                  flag: null,
                  accuracy: 0,
                })),
            ]);
          })
          .catch((e) => notify(e.message));
      }
    }
  }, [profile, preview, date]);
  useEffect(() => {
    if (!preview && profile && profile.role !== "staff") {
      fetch("/api/staff")
        .then((r) => r.json())
        .then((d) => setDirectory(d.staff || []))
        .catch(() => {});
      fetch("/api/panchayats")
        .then((r) => r.json())
        .then((d) =>
          setFences(
            Object.fromEntries(
              (d.panchayats || []).map((p: { name: string }) => [p.name, p]),
            ),
          ),
        )
        .catch(() => {});
    }
  }, [profile, preview]);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => {});
    }
  }, [camera]);
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );
  useEffect(() => {
    setPage(1);
  }, [search, panchayat, status, date]);
  const filtered = rows.filter(
    (r) =>
      (panchayat === "all" || r.panchayat === panchayat) &&
      (status === "all" ||
        (status === "flagged" ? !!r.flag : r.status === status)) &&
      [r.name, r.phone, r.position].some((s) =>
        s.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const change = (v: View) => {
    setView(v);
    setMobile(false);
    setSearch("");
    setStatus("all");
  };
  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
          admin: adminTab,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setProfile(data.profile);
      setPreview(false);
      setLogin(false);
      setConsent(false);
      setAssignment(data.profile.assignments[0]?.panchayat || "");
      setView(data.profile.role === "staff" ? "punch" : "overview");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startCapture() {
    setBusy(true);
    setGps(null);
    setPhoto(null);
    try {
      let c = challenge;
      if (!preview) {
        const r = await fetch("/api/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "challenge" }),
        });
        c = await r.json();
        if (!r.ok) throw Error((c as unknown as { error: string }).error);
        setChallenge(c);
      } else {
        c = {
          id: "preview",
          expires_at: new Date(Date.now() + 120000).toISOString(),
          server_time: new Date().toISOString(),
        };
        setChallenge(c);
      }
      const location = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
          }),
      );
      if (location.coords.accuracy > 50)
        throw Error(
          "GPS सटीकता 50 मीटर से अधिक है। खुले स्थान में दोबारा कोशिश करें।",
        );
      setGps(location.coords);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      setCamera(true);
    } catch (e) {
      notify("कैमरा और लोकेशन चालू करें। " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function capture() {
    if (!video.current || !gps || !challenge) return;
    if (Date.now() > new Date(challenge.expires_at).getTime()) {
      notify("कैप्चर की समय सीमा समाप्त। दोबारा कैमरा खोलें।");
      stopCamera();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video.current, 0, 0, 960, 720);
    ctx.fillStyle = "rgba(0,0,0,.8)";
    ctx.fillRect(0, 630, 960, 90);
    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText(
      `ARARIA | ${new Date(challenge.server_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
      20,
      660,
    );
    ctx.fillText(
      `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)} | ±${Math.round(gps.accuracy)}m | ${challenge.id.slice(0, 8)}`,
      20,
      690,
    );
    const b = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.7),
    );
    if (b) {
      setPhoto(b);
      setPhotoUrl(URL.createObjectURL(b));
    }
    stopCamera();
  }
  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  async function punch(action: string) {
    if (preview) {
      notify("यह केवल पूर्वावलोकन है। वास्तविक उपस्थिति के लिए लॉगिन करें।");
      return;
    }
    if (!consent) {
      notify("पहले गोपनीयता सूचना स्वीकार करें।");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("action", action);
      form.set("panchayat", assignment);
      if (leave) {
        if (!leaveFile) throw Error("CL/SL प्रमाण अपलोड करें।");
        form.set("file", leaveFile);
      } else {
        if (!photo || !gps || !challenge) throw Error("ताज़ा GPS फोटो लें।");
        form.set("file", photo);
        form.set("challenge", challenge.id);
        form.set("latitude", String(gps.latitude));
        form.set("longitude", String(gps.longitude));
        form.set("accuracy", String(gps.accuracy));
      }
      const uploadFile = form.get("file") as Blob;
      const signedRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: uploadFile.type, size: uploadFile.size }),
      });
      const signed = await signedRes.json();
      if (!signedRes.ok) throw Error(signed.error);
      const uploaded = await fetch(signed.url, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile,
      });
      if (!uploaded.ok) throw Error("फ़ाइल अपलोड विफल। फिर कोशिश करें।");
      form.delete("file");
      form.set("upload_path", signed.path);
      const r = await fetch("/api/attendance", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setRecord(d.record);
      setPhoto(null);
      setChallenge(null);
      notify("उपस्थिति सुरक्षित दर्ज हो गई।");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function management(e: React.FormEvent<HTMLFormElement>, kind: string) {
    e.preventDefault();
    if (preview) {
      notify("वास्तविक बदलाव के लिए एडमिन लॉगिन करें।");
      return;
    }
    setBusy(true);
    const f = new FormData(e.currentTarget);
    let body: Record<string, unknown> = { reason: f.get("reason") };
    let endpoint = "/api/admin";
    if (kind === "geofence") {
      body = {
        ...body,
        action: "geofence",
        panchayat: modal?.slice(9),
        latitude: Number(f.get("latitude")),
        longitude: Number(f.get("longitude")),
        radius: Number(f.get("radius")),
      };
    } else if (kind === "correct") {
      body = {
        ...body,
        action: "correct",
        id: modal?.split(":")[1],
        correction: {
          time_in: f.get("time_in")
            ? new Date(String(f.get("time_in")) + "+05:30").toISOString()
            : null,
          time_out: f.get("time_out")
            ? new Date(String(f.get("time_out")) + "+05:30").toISOString()
            : null,
        },
      };
    } else {
      endpoint = "/api/staff";
      body = {
        ...body,
        action: "update",
        id: modal?.split(":")[1],
        changes: {
          name: f.get("name"),
          phone: f.get("phone"),
          active: f.get("active") === "on",
          reset_device: f.get("reset_device") === "on",
        },
      };
    }
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      notify("बदलाव सुरक्षित दर्ज है।");
      setModal(null);
      if (kind === "staff") {
        const r = await fetch("/api/staff");
        setDirectory((await r.json()).staff);
      } else if (kind === "geofence") {
        setFences({ ...fences, [String(body.panchayat)]: d });
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const present = preview
      ? 186
      : rows.filter((r) => r.status === "present").length,
    onLeave = preview ? 18 : rows.filter((r) => r.status === "leave").length;
  return (
    <div className="app">
      {mobile && (
        <button
          className="scrim"
          aria-label="मेनू बंद करें"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            change("overview");
          }}
        >
          <div className="seal">
            <Icon name="shield" size={27} />
          </div>
          <div>
            <strong>अररिया</strong>
            <span>कर्मी उपस्थिति पोर्टल</span>
          </div>
        </a>
        <div className="office-label">
          पंचायती राज विभाग<span>ARARIA DISTRICT · BIHAR</span>
        </div>
        <div className="nav-label">
          कार्यस्थल <span>WORKSPACE</span>
        </div>
        <nav aria-label="मुख्य नेविगेशन">
          {(profile?.role === "staff" ? [] : nav).map(([v, icon, hi, en]) => (
            <button
              key={v}
              className={"nav-item " + (view === v ? "active" : "")}
              onClick={() => change(v)}
            >
              <Icon name={icon} />
              <span>
                {hi}
                <small>{en}</small>
              </span>
              {v === "attendance" && (
                <b className="nav-count">{preview ? "242" : rows.length}</b>
              )}
              {v === "sheets" && <i className="pending-dot" />}
            </button>
          ))}
          <button
            className={"nav-item " + (view === "punch" ? "active" : "")}
            onClick={() => change("punch")}
          >
            <Icon name="camera" />
            <span>
              मेरी उपस्थिति<small>Staff punch in / out</small>
            </span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-note">
            <Icon name="shield" size={17} />
            <span>
              सुरक्षित एवं निजी<small>Location-verified attendance</small>
            </span>
          </div>
          <button
            className={"nav-item " + (view === "settings" ? "active" : "")}
            onClick={() => change("settings")}
          >
            <Icon name="settings" />
            <span>
              सेटिंग्स<small>Settings & help</small>
            </span>
          </button>
          <div className="account">
            <div className="avatar">
              {preview ? "प्र" : profile?.name.slice(0, 1)}
            </div>
            <div>
              <strong>{preview ? "पूर्वावलोकन" : profile?.name}</strong>
              <small>
                {preview
                  ? "Preview workspace"
                  : profile?.role.replaceAll("_", " ")}
              </small>
            </div>
            <button
              title="लॉगिन / लॉगआउट"
              className="icon-button"
              onClick={async () => {
                if (profile) {
                  await fetch("/api/auth/logout", { method: "POST" });
                  setProfile(null);
                  setPreview(true);
                  setRows(demoRows);
                  change("overview");
                } else setLogin(true);
              }}
            >
              <Icon name={profile ? "logout" : "lock"} size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="मेनू खोलें"
            >
              <Icon name="menu" />
            </button>
            <span>प्रखंड पंचायत राज कार्यालय</span>
            <Icon name="chevron" size={13} />
            <strong>अररिया</strong>
          </div>
          <div className="header-right">
            <span className={"network " + (!online ? "offline" : "")}>
              <i />
              {online ? "ऑनलाइन" : "ऑफ़लाइन"}
            </span>
            <button
              className="theme-button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "रात्रि मोड" : "दिन मोड"}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} size={17} />
              <span>{theme === "light" ? "रात्रि" : "दिन"}</span>
            </button>
            <button
              className="icon-button notification"
              aria-label="सूचनाएँ"
              onClick={() => setModal("notifications")}
            >
              <Icon name="bell" />
              <i />
            </button>
            <div className="header-avatar">अ</div>
          </div>
        </header>
        <main>
          <div className="preview-banner">
            <Icon name="eye" size={16} />
            <span>
              {preview ? (
                <>
                  <strong>पूर्वावलोकन मोड</strong> · उदाहरण डेटा। वास्तविक कर्मी
                  जानकारी सुरक्षित है।
                </>
              ) : (
                <>
                  <strong>सुरक्षित कार्यस्थल</strong> · सभी समय सर्वर से दर्ज
                  होते हैं।
                </>
              )}
            </span>
            {preview && (
              <button onClick={() => setLogin(true)}>
                लॉगिन करें <Icon name="arrow" size={14} />
              </button>
            )}
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ARARIA ATTENDANCE WORKSPACE</div>
              <h1>
                {view === "overview"
                  ? "आज की उपस्थिति"
                  : view === "attendance"
                    ? "उपस्थिति रजिस्टर"
                    : view === "staff"
                      ? "कर्मी प्रबंधन"
                      : view === "panchayats"
                        ? "पंचायत एवं कार्यस्थल"
                        : view === "reports"
                          ? "रिपोर्ट एवं निर्यात"
                          : view === "sheets"
                            ? "गूगल शीट समन्वयन"
                            : view === "punch"
                              ? "मेरी दैनिक उपस्थिति"
                              : "सेटिंग्स एवं सहायता"}
              </h1>
              <p>
                {view === "overview"
                  ? "अपने प्रखंड की उपस्थिति, एक नज़र में।"
                  : view === "punch"
                    ? "लोकेशन सत्यापित करें, कैमरे से फोटो लें और उपस्थिति दर्ज करें।"
                    : "अररिया प्रखंड · पंचायती राज विभाग"}
              </p>
            </div>
            <div className="heading-actions">
              {["overview", "attendance", "reports"].includes(view) && (
                <>
                  <label className="date-control">
                    <Icon name="calendar" size={17} />
                    <input
                      type="date"
                      value={date}
                      max={today()}
                      onChange={(e) => setDate(e.target.value)}
                      aria-label="उपस्थिति की तिथि"
                    />
                  </label>
                  <button
                    className="button primary"
                    onClick={() => csv(filtered)}
                  >
                    <Icon name="download" size={17} />
                    निर्यात <span>Export</span>
                  </button>
                </>
              )}
              {view === "staff" && (
                <button
                  className="button primary"
                  onClick={() => setModal("import")}
                >
                  <Icon name="upload" size={17} />
                  कर्मी आयात करें
                </button>
              )}
            </div>
          </div>
          {view === "overview" && (
            <>
              <div className="stats-grid">
                {[
                  [
                    "उपस्थित",
                    "Present",
                    present,
                    "users",
                    "green",
                    preview ? "कुल कर्मियों का 76.9%" : "आज पंच इन किए",
                  ],
                  [
                    "अनुपस्थित",
                    "Absent",
                    preview
                      ? 38
                      : rows.filter((r) => r.status === "absent").length,
                    "calendar",
                    "red",
                    "अभी तक उपस्थिति दर्ज नहीं",
                  ],
                  [
                    "अवकाश पर",
                    "On leave",
                    onLeave,
                    "file",
                    "amber",
                    "CL / SL प्रमाण सहित",
                  ],
                  [
                    "पंच आउट बाकी",
                    "Awaiting punch out",
                    preview
                      ? 12
                      : rows.filter((r) => r.time_in && !r.time_out).length,
                    "clock",
                    "blue",
                    "पंच इन दर्ज हो चुका है",
                  ],
                ].map(([hi, en, n, ic, color, hint]) => (
                  <button
                    className={"stat-card " + color}
                    key={String(en)}
                    onClick={() => {
                      change("attendance");
                      setStatus(
                        en === "Present"
                          ? "present"
                          : en === "Absent"
                            ? "absent"
                            : en === "On leave"
                              ? "leave"
                              : "all",
                      );
                    }}
                  >
                    <div className="stat-top">
                      <span>
                        {hi}
                        <small>{en}</small>
                      </span>
                      <span className="stat-icon">
                        <Icon name={String(ic)} />
                      </span>
                    </div>
                    <div className="stat-number">
                      {n}
                      <span>
                        {en === "Present"
                          ? "/ " + (preview ? "242" : rows.length)
                          : ""}
                      </span>
                    </div>
                    <div className="stat-hint">
                      {en === "Present" && <i className="tiny-dot" />}
                      {hint}
                    </div>
                  </button>
                ))}
              </div>
              <div className="summary-grid">
                <section className="panel panchayat-summary">
                  <div className="panel-heading">
                    <div>
                      <h2>पंचायतवार स्थिति</h2>
                      <p>Attendance across panchayats</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => change("panchayats")}
                    >
                      सभी देखें <Icon name="chevron" size={14} />
                    </button>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="green-dot" />
                      उपस्थित
                    </span>
                    <span>
                      <i className="amber-dot" />
                      अवकाश
                    </span>
                    <span>
                      <i className="gray-dot" />
                      अनुपस्थित
                    </span>
                  </div>
                  <div className="bar-chart">
                    {panchayats.slice(0, 5).map((p, i) => (
                      <button
                        className="bar-row"
                        key={p}
                        onClick={() => {
                          change("attendance");
                          setPanchayat(p);
                        }}
                      >
                        <span>{p}</span>
                        <div className="bar-track">
                          <i
                            className="bar-present"
                            style={{
                              width: preview
                                ? `${[83, 72, 90, 64, 78][i]}%`
                                : "0%",
                            }}
                          />
                          <i
                            className="bar-leave"
                            style={{ width: preview ? "7%" : "0%" }}
                          />
                        </div>
                        <b>
                          {preview ? [15, 13, 18, 11, 14][i] : "—"}
                          <small>
                            {" "}
                            / {preview ? [18, 18, 20, 17, 18][i] : "—"}
                          </small>
                        </b>
                      </button>
                    ))}
                  </div>
                  <div className="chart-foot">
                    <Icon name="pin" size={14} />
                    <span>30 ग्राम पंचायतें + प्रखंड कार्यालय</span>
                  </div>
                </section>
                <section className="panel attention-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>ध्यान देने योग्य</h2>
                      <p>Items that need your attention</p>
                    </div>
                    <span className="attention-count">
                      {preview ? "03" : "02"}
                    </span>
                  </div>
                  <button
                    className="attention-item"
                    onClick={() => {
                      change("attendance");
                      setStatus("flagged");
                    }}
                  >
                    <span className="attention-icon amber">
                      <Icon name="pin" size={18} />
                    </span>
                    <div>
                      <strong>लोकेशन की समीक्षा</strong>
                      <p>
                        {preview
                          ? "2 रिकॉर्ड सत्यापन के लिए चिह्नित"
                          : "सत्यापन किए गए रिकॉर्ड यहाँ दिखेंगे"}
                      </p>
                    </div>
                    <Icon name="chevron" size={15} />
                  </button>
                  <button
                    className="attention-item"
                    onClick={() => change("staff")}
                  >
                    <span className="attention-icon red">
                      <Icon name="users" size={18} />
                    </span>
                    <div>
                      <strong>कर्मी विवरण सुधारें</strong>
                      <p>2 पहचान में नाम का अंतर · Needs fix</p>
                    </div>
                    <Icon name="chevron" size={15} />
                  </button>
                  <button
                    className="attention-item"
                    onClick={() => change("sheets")}
                  >
                    <span className="attention-icon blue">
                      <Icon name="sheet" size={18} />
                    </span>
                    <div>
                      <strong>गूगल शीट जोड़ें</strong>
                      <p>समन्वयन सेटअप अभी बाकी है</p>
                    </div>
                    <Icon name="chevron" size={15} />
                  </button>
                  <div className="attention-foot">
                    <Icon name="shield" size={14} />
                    <span>हर सुधार का ऑडिट लॉग रखा जाता है</span>
                  </div>
                </section>
              </div>
            </>
          )}
          {["overview", "attendance"].includes(view) && (
            <section className="panel attendance-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {view === "overview"
                      ? "आज का उपस्थिति रजिस्टर"
                      : "उपस्थिति विवरण"}{" "}
                    <span className="count-pill">{filtered.length}</span>
                  </h2>
                  <p>
                    {preview
                      ? "Illustrative records · no personal staff data"
                      : "Verified attendance records"}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    change("attendance");
                    setStatus("flagged");
                  }}
                >
                  <Icon name="alert" size={15} />
                  चिह्नित रिकॉर्ड
                </button>
              </div>
              <div className="filters">
                <label className="search">
                  <Icon name="search" size={18} />
                  <input
                    placeholder="कर्मी का नाम या मोबाइल खोजें…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="कर्मी खोजें"
                  />
                </label>
                <select
                  value={panchayat}
                  onChange={(e) => setPanchayat(e.target.value)}
                  aria-label="पंचायत फ़िल्टर"
                >
                  <option value="all">सभी पंचायतें</option>
                  {panchayats.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="स्थिति फ़िल्टर"
                >
                  <option value="all">सभी स्थितियाँ</option>
                  <option value="present">उपस्थित</option>
                  <option value="absent">अनुपस्थित</option>
                  <option value="leave">अवकाश</option>
                  <option value="flagged">चिह्नित</option>
                </select>
                <button
                  className="icon-button filter-reset"
                  onClick={() => {
                    setSearch("");
                    setPanchayat("all");
                    setStatus("all");
                  }}
                  title="फ़िल्टर साफ़ करें"
                >
                  <Icon name="refresh" size={17} />
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>
                        कर्मी का नाम <small>STAFF NAME</small>
                      </th>
                      <th>
                        पंचायत / पद <small>PANCHAYAT / POSITION</small>
                      </th>
                      <th>
                        पंच इन <small>TIME IN</small>
                      </th>
                      <th>
                        पंच आउट <small>TIME OUT</small>
                      </th>
                      <th>
                        लोकेशन <small>LOCATION</small>
                      </th>
                      <th>
                        स्थिति <small>STATUS</small>
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice((page - 1) * 6, page * 6).map((r, i) => (
                      <tr key={r.id}>
                        <td>
                          <div className="staff-name">
                            <div className={"small-avatar av-" + (i % 3)}>
                              क{r.name.match(/\d+/)?.[0] || ""}
                            </div>
                            <div>
                              <strong>{r.name}</strong>
                              <small>{r.department}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>{r.panchayat}</strong>
                          <small>{r.position}</small>
                        </td>
                        <td className="time-cell">{r.time_in || "—"}</td>
                        <td className="time-cell">{r.time_out || "—"}</td>
                        <td>
                          {r.status === "present" ? (
                            <span
                              className={
                                "location-badge " + (r.flag ? "warning" : "")
                              }
                            >
                              <Icon name={r.flag ? "alert" : "pin"} size={13} />
                              {r.flag ? "समीक्षा बाकी" : `± ${r.accuracy} m`}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className={"status-badge " + r.status}>
                            <i />
                            {r.status === "present"
                              ? "उपस्थित"
                              : r.status === "leave"
                                ? "अवकाश"
                                : "अनुपस्थित"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={r.name + " विवरण"}
                            onClick={() => setModal("record:" + r.id)}
                          >
                            <Icon name="chevron" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty">
                    <Icon name="search" size={28} />
                    <h3>कोई रिकॉर्ड नहीं मिला</h3>
                    <p>फ़िल्टर बदलें या दूसरी तिथि चुनें।</p>
                  </div>
                )}
              </div>
              <div className="table-footer">
                <span>
                  {filtered.length
                    ? `${(page - 1) * 6 + 1}–${Math.min(page * 6, filtered.length)}`
                    : "0"}{" "}
                  / {filtered.length} रिकॉर्ड
                </span>
                <div>
                  <button
                    className="pagination"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    पिछला
                  </button>
                  <span>
                    {page} / {Math.max(1, Math.ceil(filtered.length / 6))}
                  </span>
                  <button
                    className="pagination"
                    disabled={page * 6 >= filtered.length}
                    onClick={() => setPage(page + 1)}
                  >
                    अगला <Icon name="chevron" size={13} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {view === "staff" && (
            <>
              <div className="mini-stats">
                <span>
                  <strong>242</strong> आयात के लिए तैयार
                </span>
                <span>
                  <strong>59</strong> रिक्त पद छोड़े गए
                </span>
                <span>
                  <strong>2</strong> पहचान की समीक्षा
                </span>
              </div>
              <section className="panel section-content">
                <div className="panel-heading">
                  <div>
                    <h2>कर्मी सूची एवं आयात</h2>
                    <p>
                      One account per unique phone · all assignments retained
                    </p>
                  </div>
                  <span className="count-pill">Workbook reviewed</span>
                </div>
                <div className="info-box">
                  <Icon name="shield" />
                  <div>
                    <strong>व्यक्तिगत जानकारी सुरक्षित है</strong>
                    <p>
                      वास्तविक नाम, फोन और आयात फ़ाइल केवल अधिकृत एडमिन को
                      उपलब्ध होंगे। पूर्वावलोकन में व्यक्तिगत डेटा नहीं दिखता।
                    </p>
                  </div>
                </div>
                {!preview && (
                  <div className="step-list">
                    {directory.map((p) => (
                      <div key={p.id}>
                        <span>
                          <Icon name="users" size={14} />
                        </span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.phone} · {p.assignments.length} पंचायतें ·{" "}
                          {p.active ? "सक्रिय" : "निष्क्रिय"}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => setModal("staff:" + p.id)}
                        >
                          सुधारें
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <h3>आयात समीक्षा</h3>
                <div className="step-list">
                  {[
                    "Excel की 410 डेटा पंक्तियाँ पढ़ी गईं",
                    "एक ही फोन की पंचायत नियुक्तियाँ जोड़ी गईं",
                    "59 रिक्त पद हटाए गए",
                    "2 अलग नाम वाली पहचान रोककर समीक्षा सूची में रखी गईं",
                  ].map((s, i) => (
                    <div key={s}>
                      <span>{i + 1}</span>
                      {s}
                      <Icon name="check" size={16} />
                    </div>
                  ))}
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("import")}
                >
                  <Icon name="upload" size={17} />
                  आयात निर्देश देखें
                </button>
              </section>
            </>
          )}
          {view === "panchayats" && (
            <>
              <div className="info-box">
                <Icon name="pin" />
                <div>
                  <strong>जियोफेंस सेटअप बाकी है</strong>
                  <p>
                    पंचायतों के सत्यापित निर्देशांक मिलने तक वास्तविक पंच बंद
                    रहेंगे। प्रत्येक कार्यस्थल का प्रारंभिक दायरा 300 मीटर है।
                  </p>
                </div>
              </div>
              <div className="panchayat-grid">
                {panchayats.map((p, i) => (
                  <section className="panel panchayat-card" key={p}>
                    <span className="panchayat-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3>{p}</h3>
                    <p>
                      {i === 30
                        ? "Block Panchayati Raj Office"
                        : "Gram Panchayat · Araria"}
                    </p>
                    <div>
                      <span>
                        <i
                          className={
                            fences[p]?.latitude != null
                              ? "green-dot"
                              : "amber-dot"
                          }
                        />
                        {fences[p]?.latitude != null
                          ? "जियोफेंस तैयार"
                          : "निर्देशांक बाकी"}
                      </span>
                      <b>{fences[p]?.radius || 300} m</b>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal("geofence:" + p)}
                    >
                      जियोफेंस देखें <Icon name="arrow" size={14} />
                    </button>
                  </section>
                ))}
              </div>
            </>
          )}
          {view === "reports" && (
            <div className="report-grid">
              {[
                ["दैनिक उपस्थिति", "Daily attendance", "calendar"],
                ["पंचायतवार रिपोर्ट", "Panchayat breakdown", "pin"],
                ["पंच इन बाकी", "Missing punch report", "clock"],
                ["संदिग्ध रिकॉर्ड", "Flagged attendance", "alert"],
              ].map(([hi, en, ic]) => (
                <section className="panel report-card" key={en}>
                  <span className="report-icon">
                    <Icon name={ic} size={26} />
                  </span>
                  <h2>{hi}</h2>
                  <p>{en}</p>
                  <span className="muted">चुनी गई तिथि: {date}</span>
                  <button
                    className="button secondary"
                    onClick={() =>
                      csv(
                        en === "Flagged attendance"
                          ? rows.filter((r) => !!r.flag)
                          : en === "Missing punch report"
                            ? rows.filter(
                                (r) => !r.time_in && r.status !== "leave",
                              )
                            : rows,
                      )
                    }
                  >
                    <Icon name="download" size={16} />
                    CSV डाउनलोड
                  </button>
                </section>
              ))}
              <section className="panel section-content full-width">
                <h2>PDF के रूप में सहेजें</h2>
                <p>
                  उपस्थिति रजिस्टर खोलें और ब्राउज़र में प्रिंट → PDF चुनें।
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    change("attendance");
                    setTimeout(() => window.print(), 100);
                  }}
                >
                  प्रिंट / PDF
                </button>
              </section>
            </div>
          )}
          {view === "sheets" && (
            <section className="panel setup-panel">
              <div className="setup-icon">
                <Icon name="sheet" size={36} />
              </div>
              <span className="status-badge leave">
                <i />
                सेटअप बाकी
              </span>
              <h2>आपकी रिपोर्ट, अपने आप अपडेट।</h2>
              <p>
                Google Sheet जोड़ने पर दैनिक उपस्थिति की सुरक्षित कॉपी अपने आप
                समन्वयित होगी। मूल रिकॉर्ड डेटाबेस में रहेंगे।
              </p>
              <div className="sheet-features">
                <span>
                  <Icon name="check" size={17} />
                  हर महीने अलग टैब
                </span>
                <span>
                  <Icon name="check" size={17} />
                  पंच आउट पर वही पंक्ति अपडेट
                </span>
                <span>
                  <Icon name="check" size={17} />
                  विफलता पर दोबारा प्रयास
                </span>
              </div>
              <button
                className="button primary"
                onClick={() => setModal("sheets")}
              >
                सेटअप निर्देश <Icon name="arrow" size={16} />
              </button>
              <div className="setup-foot">
                अंतिम समन्वयन: अभी तक नहीं · Database is the source of truth
              </div>
            </section>
          )}
          {view === "settings" && (
            <section className="panel section-content">
              <h2>पोर्टल की जानकारी</h2>
              <div className="settings-list">
                {[
                  ["समय क्षेत्र", "Asia/Kolkata · समय सर्वर से"],
                  ["स्थान सत्यापन", "ताज़ा GPS · अधिकतम सटीकता 50 मीटर"],
                  ["जियोफेंस", "प्रत्येक पंचायत का दायरा 300 मीटर"],
                  ["फोटो", "लाइव कैमरा · समय और GPS वॉटरमार्क"],
                  ["एडमिन संपर्क", "sfc.aditya@gmail.com"],
                  ["स्टोरेज", "निजी · सीमित समय के हस्ताक्षरित लिंक"],
                  ["गूगल शीट", "सेटअप बाकी"],
                ].map(([a, b]) => (
                  <div key={a}>
                    <strong>{a}</strong>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setModal("privacy")}
                >
                  <Icon name="shield" size={17} />
                  गोपनीयता सूचना
                </button>
                <button
                  className="button secondary"
                  onClick={() => setModal("help")}
                >
                  <Icon name="help" size={17} />
                  कर्मी सहायता
                </button>
              </div>
            </section>
          )}
          {view === "punch" && (
            <section className="panel punch-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    दैनिक उपस्थिति <small>Daily attendance</small>
                  </h2>
                  <p>
                    {preview ? "उदाहरण कर्मी · पूर्वावलोकन" : profile?.name} ·{" "}
                    {today()}
                  </p>
                </div>
                <span className="status-badge present">
                  <Icon name="lock" size={13} />
                  सर्वर समय
                </span>
              </div>
              {!preview && !consent && (
                <div className="info-box">
                  <Icon name="shield" />
                  <div>
                    <strong>गोपनीयता एवं सहमति</strong>
                    <p>
                      उपस्थिति सत्यापन के लिए आपकी लाइव फोटो, स्थान, समय एवं
                      डिवाइस जानकारी सुरक्षित रखी जाएगी। केवल अधिकृत अधिकारी इसे
                      देख सकते हैं।
                    </p>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      मैंने सूचना पढ़ी और स्वीकार की है।
                    </label>
                  </div>
                </div>
              )}
              <div className="readonly-profile">
                <div>
                  <small>नाम / Name</small>
                  <strong>{preview ? "उदाहरण कर्मी" : profile?.name}</strong>
                </div>
                <div>
                  <small>पद / Position</small>
                  <strong>
                    {preview
                      ? "पंचायत सचिव"
                      : profile?.assignments.find(
                          (a) => a.panchayat === assignment,
                        )?.position}
                  </strong>
                </div>
                <div>
                  <small>विभाग / Department</small>
                  <strong>
                    {preview
                      ? "पंचायती राज विभाग"
                      : profile?.assignments.find(
                          (a) => a.panchayat === assignment,
                        )?.department}
                  </strong>
                </div>
              </div>
              <label className="field-label">
                कार्यस्थल / Panchayat
                <select
                  value={preview ? undefined : assignment}
                  onChange={(e) => setAssignment(e.target.value)}
                >
                  {(preview
                    ? panchayats.slice(0, 3)
                    : profile?.assignments.map((a) => a.panchayat) || []
                  ).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox leave-choice">
                <input
                  type="checkbox"
                  checked={leave}
                  onChange={(e) => {
                    setLeave(e.target.checked);
                    stopCamera();
                  }}
                />
                अवकाश पर हूँ / On leave (CL / SL)
              </label>
              {leave ? (
                <label className="upload-zone">
                  <Icon name="upload" size={28} />
                  <strong>CL / SL प्रमाण अपलोड करें</strong>
                  <span>PDF, JPG या PNG · अधिकतम 5 MB</span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.size > 5 * 1024 * 1024) {
                        notify("फ़ाइल 5 MB से छोटी रखें।");
                        e.target.value = "";
                      } else setLeaveFile(f || null);
                    }}
                  />
                </label>
              ) : (
                <div className="capture-grid">
                  <div className="camera-box">
                    {camera ? (
                      <>
                        <video ref={video} autoPlay muted playsInline />
                        <button className="button primary" onClick={capture}>
                          <Icon name="camera" size={17} />
                          फोटो लें
                        </button>
                      </>
                    ) : photoUrl ? (
                      <>
                        <img src={photoUrl} alt="कैप्चर की गई GPS फोटो" />
                        <button
                          className="button secondary"
                          onClick={startCapture}
                        >
                          दोबारा लें
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="camera-icon">
                          <Icon name="camera" size={32} />
                        </span>
                        <h3>कैमरे से ताज़ा फोटो लें</h3>
                        <p>समय और स्थान फोटो पर दर्ज होंगे।</p>
                        <button
                          className="button secondary"
                          disabled={busy || (!preview && !consent)}
                          onClick={startCapture}
                        >
                          <Icon name="camera" size={17} />
                          {busy
                            ? "अनुमति जाँच रहे हैं…"
                            : "कैमरा एवं GPS खोलें"}
                        </button>
                      </>
                    )}
                  </div>
                  <div className="location-card">
                    <Icon name="pin" size={26} />
                    <h3>आपका वर्तमान स्थान</h3>
                    {gps ? (
                      <>
                        <strong>
                          {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                        </strong>
                        <span className="location-badge">
                          सटीकता ± {Math.round(gps.accuracy)} मीटर
                        </span>
                      </>
                    ) : (
                      <p>
                        फोटो लेने पर GPS अपने आप प्राप्त होगा। लोकेशन अनुमति
                        चालू रखें।
                      </p>
                    )}
                    <div className="location-note">
                      <Icon name="lock" size={15} />
                      लोकेशन टाइप या पेस्ट नहीं की जा सकती
                    </div>
                  </div>
                </div>
              )}
              <div className="punch-actions">
                <button
                  className="button primary"
                  disabled={busy || (!preview && (!consent || !!record))}
                  onClick={() => punch(leave ? "leave" : "in")}
                >
                  <Icon name={leave ? "file" : "check"} size={18} />
                  {leave ? "अवकाश दर्ज करें" : "पंच इन / Punch in"}
                </button>
                {!leave && (
                  <button
                    className="button secondary"
                    disabled={busy || !record?.time_in || !!record.time_out}
                    onClick={() => punch("out")}
                  >
                    <Icon name="logout" size={18} />
                    पंच आउट / Punch out
                  </button>
                )}
              </div>
              {record && (
                <div className="info-box">
                  <Icon name="check" />
                  <p>
                    {record.status === "leave"
                      ? "अवकाश दर्ज है।"
                      : `पंच इन: ${new Date(record.time_in!).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} ${record.time_out ? "· पंच आउट दर्ज है।" : "· पंच आउट बाकी है।"}`}
                  </p>
                </div>
              )}
              <p className="form-foot">
                एक दिन में एक पंच इन और एक पंच आउट। जमा करने के बाद बदलाव केवल
                एडमिन कर सकते हैं।
              </p>
            </section>
          )}
          <footer className="footer">
            <span>अररिया प्रखंड · पंचायती राज विभाग</span>
            <span>
              <Icon name="shield" size={13} />
              सुरक्षित उपस्थिति, बेहतर जवाबदेही
            </span>
            <span>समय क्षेत्र: IST (UTC +05:30)</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="alert" size={18} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="संदेश बंद करें"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
      {login && (
        <div className="modal-overlay">
          <section
            className="modal login-modal"
            role="dialog"
            aria-modal="true"
            aria-label="लॉगिन"
          >
            <button
              className="modal-close icon-button"
              onClick={() => setLogin(false)}
              aria-label="बंद करें"
            >
              <Icon name="close" />
            </button>
            <div className="setup-icon">
              <Icon name="shield" size={30} />
            </div>
            <h2>उपस्थिति पोर्टल में प्रवेश</h2>
            <p>Araria staff attendance · Secure sign in</p>
            <div className="login-tabs">
              <button
                className={!adminTab ? "selected" : ""}
                onClick={() => setAdminTab(false)}
              >
                कर्मी / Staff
              </button>
              <button
                className={adminTab ? "selected" : ""}
                onClick={() => setAdminTab(true)}
              >
                एडमिन / Admin
              </button>
            </div>
            <form onSubmit={signIn}>
              <label className="field-label">
                मोबाइल या ईमेल
                <input
                  name="identifier"
                  required
                  autoComplete="username"
                  placeholder={
                    adminTab ? "एडमिन ईमेल" : "10 अंकों का मोबाइल या ईमेल"
                  }
                />
              </label>
              <label className="field-label">
                पासवर्ड
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="अपना पासवर्ड दर्ज करें"
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? "प्रवेश हो रहा है…" : "सुरक्षित लॉगिन"}
                <Icon name="arrow" size={16} />
              </button>
            </form>
            <small>लॉगिन सहायता: sfc.aditya@gmail.com</small>
          </section>
        </div>
      )}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="विवरण"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setModal(null)}
              aria-label="बंद करें"
            >
              <Icon name="close" />
            </button>
            {modal.startsWith("record:") ? (
              <>
                <h2>उपस्थिति विवरण</h2>
                {(() => {
                  const r = rows.find((r) => r.id === modal.split(":")[1]);
                  return r ? (
                    <>
                      <p>
                        {r.name} · {r.panchayat}
                      </p>
                      <div className="settings-list">
                        <div>
                          <strong>पद</strong>
                          <span>{r.position}</span>
                        </div>
                        <div>
                          <strong>पंच इन</strong>
                          <span>{r.time_in || "—"}</span>
                        </div>
                        <div>
                          <strong>पंच आउट</strong>
                          <span>{r.time_out || "—"}</span>
                        </div>
                        <div>
                          <strong>समीक्षा</strong>
                          <span>{r.flag || "कोई चिह्न नहीं"}</span>
                        </div>
                      </div>
                      <p>
                        {preview
                          ? "उदाहरण रिकॉर्ड। इसमें वास्तविक फोटो या कर्मी विवरण नहीं हैं।"
                          : "निजी फोटो केवल अधिकृत कर्मी एवं एडमिन देख सकते हैं।"}
                      </p>
                      {!preview && (
                        <div className="button-row">
                          {["photo_path", "out_photo_path", "leave_path"].map(
                            (kind, i) => (
                              <button
                                className="button secondary"
                                key={kind}
                                onClick={async () => {
                                  const res = await fetch(
                                    "/api/files?id=" + r.id + "&kind=" + kind,
                                  );
                                  const d = await res.json();
                                  if (res.ok)
                                    window.open(
                                      d.url,
                                      "_blank",
                                      "noopener,noreferrer",
                                    );
                                  else notify(d.error);
                                }}
                              >
                                {
                                  [
                                    "पंच इन फोटो",
                                    "पंच आउट फोटो",
                                    "अवकाश प्रमाण",
                                  ][i]
                                }
                              </button>
                            ),
                          )}
                        </div>
                      )}
                      {!preview && profile?.role !== "district_viewer" && (
                        <form onSubmit={(e) => management(e, "correct")}>
                          <label className="field-label">
                            पंच इन (IST)
                            <input
                              type="datetime-local"
                              name="time_in"
                              required
                            />
                          </label>
                          <label className="field-label">
                            पंच आउट (IST)
                            <input type="datetime-local" name="time_out" />
                          </label>
                          <label className="field-label">
                            सुधार कारण
                            <input name="reason" required minLength={10} />
                          </label>
                          <button className="button primary" disabled={busy}>
                            सुधार सुरक्षित करें
                          </button>
                        </form>
                      )}
                    </>
                  ) : null;
                })()}
              </>
            ) : modal.startsWith("geofence:") ? (
              <>
                <h2>{modal.slice(9)}</h2>
                <p>
                  सत्यापित अक्षांश और देशांतर एडमिन सेटअप में आवश्यक हैं।
                  अनुमानित निर्देशांक इस्तेमाल नहीं किए जाते।
                </p>
                <div className="settings-list">
                  <div>
                    <strong>प्रारंभिक दायरा</strong>
                    <span>300 मीटर</span>
                  </div>
                  <div>
                    <strong>स्थिति</strong>
                    <span>
                      {fences[modal.slice(9)]?.latitude != null
                        ? "जियोफेंस तैयार"
                        : "निर्देशांक बाकी · पंच बंद"}
                    </span>
                  </div>
                </div>
                {!preview && profile?.role === "super_admin" && (
                  <form onSubmit={(e) => management(e, "geofence")}>
                    <label className="field-label">
                      अक्षांश
                      <input
                        name="latitude"
                        type="number"
                        step="any"
                        required
                        min={-90}
                        max={90}
                        defaultValue={
                          fences[modal.slice(9)]?.latitude ?? undefined
                        }
                      />
                    </label>
                    <label className="field-label">
                      देशांतर
                      <input
                        name="longitude"
                        type="number"
                        step="any"
                        required
                        min={-180}
                        max={180}
                        defaultValue={
                          fences[modal.slice(9)]?.longitude ?? undefined
                        }
                      />
                    </label>
                    <label className="field-label">
                      दायरा (मीटर)
                      <input
                        name="radius"
                        type="number"
                        required
                        min={50}
                        max={5000}
                        defaultValue={fences[modal.slice(9)]?.radius || 300}
                      />
                    </label>
                    <label className="field-label">
                      बदलाव का कारण
                      <input name="reason" minLength={10} required />
                    </label>
                    <button className="button primary" disabled={busy}>
                      जियोफेंस सुरक्षित करें
                    </button>
                  </form>
                )}
              </>
            ) : modal.startsWith("staff:") ? (
              <>
                <h2>कर्मी विवरण सुधारें</h2>
                {(() => {
                  const p = directory.find((p) => p.id === modal.split(":")[1]);
                  return p ? (
                    <form onSubmit={(e) => management(e, "staff")}>
                      <label className="field-label">
                        नाम
                        <input name="name" defaultValue={p.name} required />
                      </label>
                      <label className="field-label">
                        मोबाइल
                        <input
                          name="phone"
                          defaultValue={p.phone}
                          pattern="[6-9][0-9]{9}"
                          required
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={p.active}
                        />
                        खाता सक्रिय
                      </label>
                      <label className="checkbox">
                        <input type="checkbox" name="reset_device" />
                        डिवाइस बाइंडिंग रीसेट करें
                      </label>
                      <label className="field-label">
                        बदलाव का कारण
                        <input name="reason" required minLength={10} />
                      </label>
                      <button className="button primary" disabled={busy}>
                        बदलाव सुरक्षित करें
                      </button>
                    </form>
                  ) : null;
                })()}
              </>
            ) : modal === "sheets" ? (
              <>
                <h2>Google Sheets सेटअप</h2>
                <ol>
                  <li>Google Cloud में Sheets API चालू करें।</li>
                  <li>सेवा खाते के ईमेल को शीट का Editor बनाएँ।</li>
                  <li>
                    Vercel में Sheet ID और सेवा खाते की credentials सेट करें।
                  </li>
                  <li>संरक्षित sync endpoint को प्रति मिनट चलाएँ।</li>
                </ol>
                <p>शीट में परिवर्तन मूल उपस्थिति को नहीं बदलते।</p>
              </>
            ) : modal === "import" ? (
              <>
                <h2>सुरक्षित कर्मी आयात</h2>
                <p>
                  स्रोत workbook का निजी आयात तैयार है। 242 खाते तैयार हैं; दो
                  पहचान की समीक्षा करें।
                </p>
                <ol>
                  <li>Supabase schema लागू करें।</li>
                  <li>सर्वर की service-role key सेट करें।</li>
                  <li>निजी import फ़ाइल को समीक्षा करके seed script चलाएँ।</li>
                  <li>
                    बनी credentials फ़ाइल केवल अधिकृत कर्मियों तक पहुँचाएँ।
                  </li>
                </ol>
                <p>
                  किसी भी credential फ़ाइल को सार्वजनिक repository में न रखें।
                </p>
              </>
            ) : modal === "privacy" ? (
              <>
                <h2>गोपनीयता सूचना</h2>
                <p>
                  उपस्थिति के लिए GPS फोटो, वर्तमान स्थान, समय, नेटवर्क एवं
                  डिवाइस संकेत लिए जाते हैं। जानकारी निजी डेटाबेस और स्टोरेज में
                  रखी जाती है। अधिकृत एडमिन सत्यापन और आवश्यक सुधार कर सकते हैं।
                </p>
                <p>
                  डेटा कम से कम एक वर्ष रखा जाएगा। पूछताछ: sfc.aditya@gmail.com।
                </p>
              </>
            ) : modal === "notifications" ? (
              <>
                <h2>सूचनाएँ</h2>
                <p>
                  Google Sheet सेटअप बाकी है। दो आयात पहचान की समीक्षा आवश्यक
                  है। पंचायतों के निर्देशांक सेट करने के बाद वास्तविक पंच चालू
                  होंगे।
                </p>
              </>
            ) : (
              <>
                <h2>कर्मी सहायता</h2>
                <ol>
                  <li>अपने मोबाइल या ईमेल एवं पासवर्ड से लॉगिन करें।</li>
                  <li>अपनी नियुक्त पंचायत चुनें।</li>
                  <li>लोकेशन और कैमरे की अनुमति दें, ताज़ा फोटो लें।</li>
                  <li>
                    पंच इन करें; कार्यालय छोड़ते समय नई फोटो लेकर पंच आउट करें।
                  </li>
                  <li>अवकाश पर हों तो CL / SL प्रमाण अपलोड करें।</li>
                </ol>
                <p>
                  ऑफ़लाइन होने पर उपस्थिति जमा नहीं होती। नेटवर्क आने पर दोबारा
                  प्रयास करें।
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
