"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  Profile,
  Assignment,
  LeaveBalance,
  LeaveBalanceSnapshot,
} from "../lib/types";
import "../app/simple.css";
import { LanguageSwitcher, Localized } from "../lib/portal-language";
import { EyeIcon } from "./ControlIcons";
import DepartmentBrand from "./DepartmentBrand";
import { useOfficeFeed, NoticeBoard, OfficeSettings } from "./OfficeBoard";
import { officeClosure, type OfficeFeed } from "../lib/office-types";
import { prepareWorkplacePhoto } from "../lib/photo-upload";
import {
  openStreetMapEmbedUrl,
  openStreetMapUrl,
  type CameraLocation,
} from "../lib/osm-camera";
import ReportDownload from "./ReportDownload";
import StaffEditor from "./StaffEditor";

const AdminCaptcha = dynamic(() => import("./AdminCaptcha"));
const WorkplaceCamera = dynamic(() => import("./WorkplaceCamera"));

type RecordRow = {
  id: string;
  staff_id: string;
  staff_name?: string;
  flags?: string[];
  date: string;
  department?: string;
  position?: string;
  panchayat: string;
  block?: string;
  status: string;
  phase?: string;
  deputation_workplace?: string | null;
  leave_type?: string | null;
  absence_reason?: string | null;
  time_in: string | null;
  time_out: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  photo_path?: string | null;
  leave_path?: string | null;
  profiles?: Profile;
  working_places?: Assignment[];
};
type Bootstrap = {
  profile: Profile;
  date: string;
  records: RecordRow[];
  staff: Profile[];
  office: OfficeFeed;
  revisions?: Revisions;
  leaveBalances?: LeaveBalanceSnapshot;
};

function LeaveBalanceDisplay({
  balance,
  gender,
}: {
  balance?: LeaveBalance;
  gender?: Profile["gender"];
}) {
  return (
    <span className="sp-leave-balance">
      CL: {balance?.cl_left ?? "—"}/16 left
      {gender === "female" ? (
        <>
          {" "}
          • SL: {balance?.sl_left ?? "—"}/24 this year,{" "}
          {balance?.sl_month_left ?? "—"}/2 this month
        </>
      ) : gender === "male" ? (
        <> • SL: not eligible</>
      ) : (
        <> • SL: ask admin to set gender</>
      )}
    </span>
  );
}
type Revisions = {
  profile: number;
  directory: number;
  attendance: number;
  holidays: number;
  notices: number;
  today: string;
};
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api(url: string, body?: object) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(
      url === "/api/attendance-workflow" && body ? 45000 : 25000,
    ),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      data.error || "अनुरोध विफल हुआ। फिर कोशिश करें।",
      response.status,
    );
  if (
    body &&
    [
      "/api/attendance-workflow",
      "/api/admin",
      "/api/staff",
      "/api/office",
    ].includes(url)
  )
    window.dispatchEvent(new Event("araria:changed"));
  return data;
}
function dateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function time(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
const statusLabels: Record<string, string> = {
  present: "उपस्थित / Present",
  absent: "अनुपस्थित / Absent",
  leave: "अवकाश / On leave",
  deputation: "प्रतिनियुक्ति / Deputation",
};
function phase(row: RecordRow) {
  return row.phase === "submitted"
    ? "completed"
    : row.phase || (row.time_in && !row.time_out ? "draft" : "completed");
}
function phaseLabel(row: RecordRow) {
  return phase(row) === "draft" ? "कार्यस्थल पर • Draft" : "सहेजा गया • Saved";
}
function unique(values: (string | undefined)[]) {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <Localized>
      <label className="sp-field">
        {label}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">{required ? "चुनें / Choose" : "सभी / All"}</option>
          {options.map((option) => (
            <option key={option} value={option} translate="no">
              {option}
            </option>
          ))}
        </select>
      </label>
    </Localized>
  );
}
function RecordDetails({
  row,
  showCameraLocation = true,
}: {
  row: RecordRow;
  showCameraLocation?: boolean;
}) {
  const assignment = row.working_places?.find(
    (a) => a.panchayat === row.panchayat,
  );
  const items = [
    ["विभाग / Department", row.department || assignment?.department],
    ["प्रखंड / Block", row.block || row.profiles?.block],
    ["पंचायत / Panchayat", row.panchayat],
    ["पद / Position", row.position || assignment?.position],
    ["स्थिति / Status", statusLabels[row.status] || row.status],
    ["प्रतिनियुक्ति स्थान / Deputation workplace", row.deputation_workplace],
    ["अवकाश / Leave", row.leave_type],
    ["अनुपस्थिति का कारण / Absence reason", row.absence_reason],
    ["आने का समय / In time", time(row.time_in)],
    ["जाने का समय / Out time", time(row.time_out)],
  ];
  return (
    <Localized>
      <>
        <dl className="sp-details">
          {items
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd
                  translate={
                    [
                      "विभाग / Department",
                      "प्रखंड / Block",
                      "पंचायत / Panchayat",
                      "पद / Position",
                      "प्रतिनियुक्ति स्थान / Deputation workplace",
                    ].includes(label || "")
                      ? "no"
                      : undefined
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
        </dl>
        {showCameraLocation &&
          Number.isFinite(row.latitude) &&
          Number.isFinite(row.longitude) && (
            <p className="sp-note">
              कैमरे द्वारा दिया गया स्थान / Camera-reported location:{" "}
              {row.latitude?.toFixed(6)}, {row.longitude?.toFixed(6)}
              {Number.isFinite(row.accuracy) &&
                ` • ±${Math.round(row.accuracy!)} m`}{" "}
              <a
                href={openStreetMapUrl({
                  latitude: row.latitude!,
                  longitude: row.longitude!,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in OpenStreetMap
              </a>
            </p>
          )}
      </>
    </Localized>
  );
}

function SavedAttendanceEvidence({ row }: { row: RecordRow }) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const hasLocation =
    Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
  useEffect(() => {
    if (!row.photo_path) return;
    let cancelled = false;
    setPhotoUrl("");
    setPhotoError("");
    void api(`/api/files?id=${encodeURIComponent(row.id)}&kind=photo_path`)
      .then((result) => {
        if (!cancelled) setPhotoUrl(result.url);
      })
      .catch((error) => {
        if (!cancelled)
          setPhotoError(
            error instanceof Error
              ? error.message
              : "फोटो नहीं खुली। / Could not load photo.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.photo_path, refresh]);
  if (!row.photo_path && !hasLocation) return null;
  const coordinates = {
    latitude: row.latitude!,
    longitude: row.longitude!,
  };
  return (
    <section
      className="sp-saved-gps"
      aria-label="Attendance photo and location"
    >
      <h3>
        {row.photo_path && hasLocation
          ? "कैमरे से ली गई GPS फोटो / Geotagged camera photo"
          : row.photo_path
            ? "कार्यस्थल फोटो / Workplace photo"
            : "कैमरा स्थान / Camera location"}
      </h3>
      {row.photo_path && (
        <>
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noopener noreferrer">
              <img
                className="sp-saved-photo"
                src={photoUrl}
                alt={
                  hasLocation
                    ? "Staff camera photo with location and time stamp"
                    : "Staff workplace photo"
                }
                onError={() => {
                  setPhotoUrl("");
                  setPhotoError(
                    "फोटो लिंक समाप्त हो गया। फिर से लोड करें। / Photo link expired. Reload it.",
                  );
                }}
              />
            </a>
          ) : photoError ? (
            <p role="alert" className="sp-alert sp-error">
              {photoError}
            </p>
          ) : (
            <p role="status">फोटो लोड हो रही है… / Loading photo…</p>
          )}
          <button
            type="button"
            className="sp-button sp-secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            फोटो फिर से लोड करें / Reload photo
          </button>
        </>
      )}
      {hasLocation && (
        <div className="sp-saved-location">
          <p>
            सहेजा गया स्थान / Saved location: {row.latitude!.toFixed(6)},{" "}
            {row.longitude!.toFixed(6)}
            {Number.isFinite(row.accuracy) &&
              ` • ±${Math.round(row.accuracy!)} m`}
          </p>
          <div className="sp-actions">
            <a
              href={openStreetMapUrl(coordinates)}
              target="_blank"
              rel="noopener noreferrer"
              className="sp-button sp-secondary"
            >
              मानचित्र में खोलें / Open location in map
            </a>
            <button
              type="button"
              className="sp-button sp-secondary"
              onClick={() => setShowMap((value) => !value)}
            >
              {showMap
                ? "मानचित्र बंद करें / Hide map"
                : "मानचित्र देखें / View map"}
            </button>
          </div>
          {showMap && (
            <iframe
              title="Map of saved staff location"
              src={openStreetMapEmbedUrl(coordinates)}
              className="sp-camera-map"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>
      )}
    </section>
  );
}

export default function Portal({
  adminLogin = false,
}: {
  adminLogin?: boolean;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [revisions, setRevisions] = useState<Revisions | null>(null);
  const revisionRef = useRef<Revisions | null>(null);
  const [activeDepartment, setActiveDepartment] = useState("");
  useEffect(() => {
    setActiveDepartment("");
  }, [profile?.id]);
  const loginRole = adminLogin ? "admin" : "staff";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sessionGeneration = useRef(0);
  const fail = useCallback((err: unknown) => {
    if (err instanceof RequestError && err.status === 401) {
      sessionGeneration.current++;
      setProfile(null);
      setBootstrap(null);
      setRevisions(null);
      revisionRef.current = null;
      setPassword("");
      setShowPassword(false);
    }
    setError(err instanceof Error ? err.message : "अनुरोध विफल हुआ।");
  }, []);
  useEffect(() => {
    let active = true;
    const generation = sessionGeneration.current;
    api("/api/session")
      .then((data) => {
        if (active && generation === sessionGeneration.current) {
          if ((data.profile.role !== "staff") !== adminLogin) {
            window.location.replace(
              data.profile.role === "staff" ? "/" : "/admin",
            );
            return;
          }
          setBootstrap(data.bootstrap || null);
          setRevisions(data.bootstrap?.revisions || null);
          revisionRef.current = data.bootstrap?.revisions || null;
          setProfile(data.profile);
        }
      })
      .catch((err) => {
        if (
          active &&
          generation === sessionGeneration.current &&
          !(err instanceof RequestError && err.status === 401)
        )
          fail(err);
      });
    return () => {
      active = false;
    };
  }, [fail, adminLogin]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    sessionGeneration.current++;
    setShowPassword(false);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/api/auth/login", {
        identifier,
        password,
        admin: loginRole === "admin",
        ...(adminLogin ? { captcha_token: captchaToken } : {}),
      });
      setPassword("");
      setBootstrap(data.bootstrap || null);
      setRevisions(data.bootstrap?.revisions || null);
      revisionRef.current = data.bootstrap?.revisions || null;
      setProfile(data.profile);
    } catch (err) {
      fail(err);
    } finally {
      if (adminLogin) {
        setCaptchaToken("");
        setCaptchaReset((value) => value + 1);
      }
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", {});
      sessionGeneration.current++;
      setProfile(null);
      setBootstrap(null);
      setRevisions(null);
      revisionRef.current = null;
      setIdentifier("");
      setPassword("");
      setShowPassword(false);
      setMessage("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!profile || !revisions) return;
    let active = true;
    let pending = false;
    const generation = sessionGeneration.current;
    const probe = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = (await api("/api/changes")) as Revisions;
        if (!active || generation !== sessionGeneration.current) return;
        const prior = revisionRef.current;
        if (
          !prior ||
          Object.keys(next).some(
            (key) =>
              next[key as keyof Revisions] !== prior[key as keyof Revisions],
          )
        ) {
          if (prior && next.profile !== prior.profile) {
            const data = await api("/api/session");
            if (!active || generation !== sessionGeneration.current) return;
            if ((data.profile.role !== "staff") !== adminLogin) {
              window.location.replace(
                data.profile.role === "staff" ? "/" : "/admin",
              );
              return;
            }
            setProfile(data.profile);
            setBootstrap(data.bootstrap || null);
          }
          revisionRef.current = next;
          setRevisions(next);
        }
      } catch (err) {
        if (!active || generation !== sessionGeneration.current) return;
        if (
          err instanceof RequestError &&
          [401, 403, 409].includes(err.status)
        ) {
          setProfile(null);
          setBootstrap(null);
          setRevisions(null);
          revisionRef.current = null;
          setError("सत्र समाप्त हो गया या खाता निष्क्रिय है। फिर लॉगिन करें।");
        }
      } finally {
        pending = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void probe();
    };
    const timer = setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    window.addEventListener("araria:changed", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("araria:changed", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [profile?.id, !!revisions, adminLogin]);
  return (
    <Localized>
      <div className="simple-portal">
        <header className="sp-header">
          <DepartmentBrand
            key={profile?.id || "public"}
            profile={profile}
            selected={activeDepartment}
            adminLogin={adminLogin}
          />
          <div className="sp-header-controls">
            <LanguageSwitcher />
            {profile && (
              <div className="sp-account">
                <span translate="no">{profile.name}</span>
                <button
                  type="button"
                  className="sp-button sp-secondary"
                  disabled={busy}
                  onClick={logout}
                >
                  लॉग आउट / Logout
                </button>
              </div>
            )}
          </div>
        </header>
        <main className={profile ? "sp-main" : "sp-main sp-login-main"}>
          {error && (
            <div role="alert" className="sp-alert sp-error">
              {error}
            </div>
          )}
          {message && (
            <div role="status" className="sp-alert sp-success">
              {message}
            </div>
          )}
          {!profile ? (
            <section className="sp-card sp-login">
              <span className="sp-eyebrow">सुरक्षित प्रवेश / SECURE LOGIN</span>
              <h1>
                {adminLogin
                  ? "प्रशासक लॉगिन / Admin login"
                  : "कर्मी लॉगिन / Staff login"}
              </h1>
              <p className="sp-muted">अपना लॉगिन विवरण और पासवर्ड डालें।</p>
              <form onSubmit={login}>
                <label className="sp-field">
                  {loginRole === "admin"
                    ? "ईमेल या मोबाइल / Email or mobile"
                    : "मोबाइल नंबर / Mobile number"}
                  <input
                    required
                    autoComplete="username"
                    inputMode={loginRole === "staff" ? "tel" : "email"}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </label>
                <div className="sp-field">
                  <label htmlFor="login-password">पासवर्ड / Password</label>
                  <div className="sp-password-row">
                    <input
                      id="login-password"
                      required
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="sp-button sp-secondary sp-password-toggle"
                      aria-controls="login-password"
                      aria-pressed={showPassword}
                      aria-label={
                        showPassword ? "पासवर्ड छिपाएँ" : "पासवर्ड दिखाएँ"
                      }
                      title={showPassword ? "पासवर्ड छिपाएँ" : "पासवर्ड दिखाएँ"}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      <EyeIcon visible={showPassword} />
                    </button>
                  </div>
                </div>
                {adminLogin && (
                  <AdminCaptcha
                    onToken={setCaptchaToken}
                    resetKey={captchaReset}
                  />
                )}
                <button
                  className="sp-button sp-primary sp-full"
                  disabled={busy || (adminLogin && !captchaToken)}
                >
                  {busy ? "प्रवेश हो रहा है…" : "लॉगिन / Login"}
                </button>
              </form>
              <p className="sp-note">
                केवल पंजीकृत कर्मी और प्रशासक प्रवेश कर सकते हैं। पासवर्ड के लिए
                कार्यालय से संपर्क करें।
              </p>
            </section>
          ) : profile.role === "staff" ? (
            <Staff
              key={profile.id}
              profile={profile}
              initial={bootstrap?.profile.id === profile.id ? bootstrap : null}
              revisions={revisions}
              onDepartmentChange={setActiveDepartment}
              fail={fail}
              notify={(value) => {
                setMessage(value);
                setError("");
              }}
            />
          ) : (
            <Admin
              key={profile.id}
              fail={fail}
              initial={bootstrap?.profile.id === profile.id ? bootstrap : null}
              revisions={revisions}
              canManage={profile.role !== "district_viewer"}
              adminBlock={profile.block}
            />
          )}
        </main>
        <footer className="sp-footer">
          <span>अररिया • कर्मचारी उपस्थिति पोर्टल</span>
          <span className="sp-footer-credit" translate="no">
            Built by{" "}
            <a
              href="https://github.com/ashuujha"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ashutosh Jha
            </a>
          </span>
        </footer>
      </div>
    </Localized>
  );
}

function Staff({
  profile,
  initial,
  revisions,
  onDepartmentChange,
  fail,
  notify,
}: {
  profile: Profile;
  initial?: Bootstrap | null;
  revisions: Revisions | null;
  onDepartmentChange: (department: string) => void;
  fail: (err: unknown) => void;
  notify: (message: string) => void;
}) {
  const office = useOfficeFeed(initial?.office, revisions);
  const closure = office.feed
    ? officeClosure(office.feed.today, office.feed.holidays)
    : null;
  const [record, setRecord] = useState<RecordRow | null>(
    initial?.records[0] || null,
  );
  const [leaveBalances, setLeaveBalances] =
    useState<LeaveBalanceSnapshot | null>(initial?.leaveBalances || null);
  useEffect(() => {
    if (initial?.leaveBalances) setLeaveBalances(initial.leaveBalances);
  }, [initial?.leaveBalances]);
  const [loading, setLoading] = useState(!initial),
    [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [department, setDepartment] = useState(""),
    [panchayat, setPanchayat] = useState(""),
    [position, setPosition] = useState("");
  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState("");
  const [status, setStatus] = useState("present"),
    [deputation, setDeputation] = useState(""),
    [leaveType, setLeaveType] = useState("CL");
  useEffect(() => {
    if (profile.gender !== "female" && leaveType === "SL") setLeaveType("CL");
  }, [profile.gender, leaveType]);
  const [workplacePhoto, setWorkplacePhoto] = useState<File | null>(null);
  const [capturedLocation, setCapturedLocation] =
    useState<CameraLocation | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [absenceReason, setAbsenceReason] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  useEffect(() => {
    if (!workplacePhoto) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(workplacePhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [workplacePhoto]);
  const [leave, setLeave] = useState<File | null>(null),
    [consent, setConsent] = useState(false);
  const alive = useRef(true);
  const staffRequestId = useRef(0);
  const retryLoad = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignments = (profile.assignments || []).filter(
    (a) => a.department?.trim() && a.panchayat?.trim() && a.position?.trim(),
  );
  const workspaceKey = (a: Assignment) =>
    JSON.stringify([a.department, a.panchayat, a.position]);
  const workspaceOptions = assignments.filter(
    (a, index) =>
      assignments.findIndex(
        (other) => workspaceKey(other) === workspaceKey(a),
      ) === index,
  );
  const hasMultipleWorkspaces =
    new Set(workspaceOptions.map((a) => a.panchayat)).size > 1;
  const selectedWorkspace = hasMultipleWorkspaces
    ? workspaceOptions.find((a) => workspaceKey(a) === selectedWorkspaceKey)
    : undefined;
  useEffect(() => {
    onDepartmentChange(
      selectedWorkspace?.department ||
        department ||
        profile.assignments[0]?.department ||
        "",
    );
  }, [
    selectedWorkspace?.department,
    department,
    profile.assignments,
    onDepartmentChange,
  ]);
  const departments = unique(assignments.map((a) => a.department));
  const panchayats = unique(
    assignments
      .filter((a) => a.department === department)
      .map((a) => a.panchayat),
  );
  const positions = unique(
    assignments
      .filter((a) => a.department === department && a.panchayat === panchayat)
      .map((a) => a.position),
  );
  const load = useCallback(
    async (background = false) => {
      const requestId = ++staffRequestId.current;
      if (!background) setLoading(true);
      try {
        const data = await api("/api/attendance-workflow");
        if (alive.current && requestId === staffRequestId.current) {
          if (retryLoad.current) clearTimeout(retryLoad.current);
          setRecord(
            (data.records || []).find(
              (row: RecordRow) => row.date === dateToday(),
            ) || null,
          );
          if (data.leaveBalances) setLeaveBalances(data.leaveBalances);
          setLoadError(false);
        }
      } catch (err) {
        if (alive.current && requestId === staffRequestId.current) {
          if (
            !background ||
            (err instanceof RequestError && err.status === 401)
          ) {
            setLoadError(true);
            fail(err);
          }
          if (retryLoad.current) clearTimeout(retryLoad.current);
          retryLoad.current = setTimeout(() => {
            if (alive.current && document.visibilityState === "visible")
              void load(background);
          }, 5000);
        }
      } finally {
        if (
          !background &&
          alive.current &&
          requestId === staffRequestId.current
        )
          setLoading(false);
      }
    },
    [fail],
  );
  useEffect(() => {
    alive.current = true;
    if (!initial) void load();
    return () => {
      alive.current = false;
      staffRequestId.current++;
      if (retryLoad.current) clearTimeout(retryLoad.current);
    };
  }, [load, initial]);
  const lastAttendanceRevision = useRef({
    attendance: revisions?.attendance,
    today: revisions?.today,
  });
  useEffect(() => {
    const prior = lastAttendanceRevision.current;
    if (
      prior.attendance !== revisions?.attendance ||
      prior.today !== revisions?.today
    ) {
      lastAttendanceRevision.current = {
        attendance: revisions?.attendance,
        today: revisions?.today,
      };
      void load(true);
    }
  }, [revisions?.attendance, revisions?.today, load]);
  useEffect(() => {
    if (department && !departments.includes(department)) {
      setDepartment("");
      setPanchayat("");
      setPosition("");
      notify("Your assignment changed. Please choose your current workplace.");
    } else if (panchayat && !panchayats.includes(panchayat)) {
      setPanchayat("");
      setPosition("");
    } else if (position && !positions.includes(position)) setPosition("");
  }, [
    profile.assignments,
    departments,
    panchayats,
    positions,
    department,
    panchayat,
    position,
    notify,
  ]);
  useEffect(() => {
    if (departments.length === 1) setDepartment(departments[0]);
  }, [departments.join("|")]); // Only workbook-backed options are selected.
  useEffect(() => {
    if (panchayats.length === 1) setPanchayat(panchayats[0]);
  }, [panchayats.join("|")]);
  useEffect(() => {
    if (positions.length === 1) setPosition(positions[0]);
  }, [positions.join("|")]);
  async function upload(file: Blob, purpose = "leave_document") {
    if (!file.size || file.size >= 5 * 1024 * 1024)
      throw new Error(
        "फ़ाइल 5 MB से कम होनी चाहिए। / File must be smaller than 5 MB.",
      );
    if (purpose === "workplace_photo") file = await prepareWorkplacePhoto(file);
    const signed = await api("/api/upload", {
      type: file.type,
      size: file.size,
      purpose,
    });
    const result = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
      signal: AbortSignal.timeout(45000),
    });
    if (!result.ok) throw new Error("फ़ाइल अपलोड विफल। फिर कोशिश करें।");
    return signed.path;
  }
  async function save(event?: React.FormEvent, complete = false) {
    event?.preventDefault();
    setBusy(true);
    notify("");
    try {
      if (!office.feed || office.error || closure)
        throw new Error(
          closure
            ? `Holiday (${closure}). Attendance is closed.`
            : "अवकाश कैलेंडर रीफ़्रेश करें। / Refresh the holiday calendar.",
        );
      if (!complete && hasMultipleWorkspaces && !selectedWorkspace)
        throw new Error(
          "आज की उपस्थिति के लिए एक कार्यस्थल चुनें। / Select one assigned workspace for today’s attendance.",
        );

      const body: { [key: string]: unknown } = {
        action: complete
          ? "complete"
          : status === "present" || status === "deputation"
            ? "save_draft"
            : "save_status",
        panchayat: selectedWorkspace?.panchayat || panchayat,
        department: selectedWorkspace?.department || department,
        position: selectedWorkspace?.position || position,
        status,
        deputation_workplace:
          status === "deputation" ? deputation.trim() : null,
        leave_type: status === "leave" ? leaveType : null,
        absence_reason: status === "absent" ? absenceReason.trim() : null,
      };
      if (complete) {
        body.id = record?.id;
      } else {
        if (!consent)
          throw new Error("उपस्थिति की जानकारी साझा करने की सहमति दें।");
        if (
          status === "absent" &&
          (absenceReason.trim().length < 3 ||
            absenceReason.trim().length > 1000)
        )
          throw new Error(
            "अनुपस्थिति का कारण लिखें (3–1000 अक्षर)। / Enter an absence reason (3–1000 characters).",
          );
        if (status === "present" || status === "deputation") {
          if (
            !workplacePhoto ||
            !["image/jpeg", "image/png"].includes(workplacePhoto.type) ||
            !workplacePhoto.size ||
            workplacePhoto.size >= 5 * 1024 * 1024
          )
            throw new Error(
              "कार्यस्थल की JPEG/PNG फोटो दें, 5 MB से कम। / Upload a workplace JPEG/PNG photo smaller than 5 MB.",
            );
          body.photo_upload_path = await upload(
            workplacePhoto,
            "workplace_photo",
          );
          if (capturedLocation) {
            body.latitude = capturedLocation.latitude;
            body.longitude = capturedLocation.longitude;
            body.accuracy = capturedLocation.accuracy;
          }
        }
        if (status === "leave") {
          if (
            !leave ||
            !["image/jpeg", "application/pdf"].includes(leave.type) ||
            !leave.size ||
            leave.size >= 5 * 1024 * 1024
          )
            throw new Error(
              "अवकाश के लिए JPG या PDF दस्तावेज़ दें, 5 MB से कम। / Upload a leave document in JPG or PDF, smaller than 5 MB.",
            );
          body.leave_upload_path = await upload(leave);
        }
      }
      const saved = await api("/api/attendance-workflow", body);
      if (!alive.current) return;
      if (!saved.record?.id)
        throw new Error(
          "सहेजी गई उपस्थिति नहीं मिली। रीफ़्रेश करें। / Saved attendance not returned. Refresh to confirm.",
        );
      staffRequestId.current++;
      setRecord(saved.record);
      if (saved.leaveBalances) setLeaveBalances(saved.leaveBalances);
      setLoading(false);
      setLoadError(false);
      setLeave(null);
      setWorkplacePhoto(null);
      setCapturedLocation(null);
      setCameraOpen(false);
      notify(
        complete
          ? "जाने का समय सहेज दिया गया।"
          : "उपस्थिति सहेज दी गई। प्रशासक इसे देख सकते हैं।",
      );
    } catch (err) {
      if (alive.current) fail(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Localized>
      <>
        <div className="sp-page-title">
          <div>
            <span className="sp-eyebrow">कर्मी / STAFF</span>
            <h1>आज की उपस्थिति</h1>
            <p className="sp-muted">
              {dateToday()} • आने पर जानकारी सहेजें, जाते समय आउट टाइम दर्ज
              करें।
            </p>
          </div>
          <button
            className="sp-button sp-secondary"
            onClick={() => {
              void load();
              void office.reload();
            }}
            disabled={busy || loading}
          >
            रीफ़्रेश / Refresh
          </button>
        </div>
        {office.feed && <NoticeBoard notices={office.feed.notices} />}
        <section className="sp-card">
          <div className="sp-identity">
            <div>
              <span className="sp-muted">कर्मी का नाम / Staff name</span>
              <strong translate="no">{profile.name}</strong>
            </div>
            <div>
              <span className="sp-muted">प्रखंड / Block</span>
              <strong>{profile.block || "कार्यालय से संपर्क करें"}</strong>
            </div>
            <div>
              <span className="sp-muted">
                अवकाश शेष / Leave left (
                {leaveBalances?.year || new Date().getFullYear()})
              </span>
              <strong>
                <LeaveBalanceDisplay
                  balance={leaveBalances?.balances.find(
                    (entry) => entry.staff_id === profile.id,
                  )}
                  gender={profile.gender}
                />
              </strong>
            </div>
          </div>
          {loading ? (
            <p role="status">उपस्थिति लोड हो रही है…</p>
          ) : loadError ? (
            <p>उपस्थिति नहीं मिली। रीफ़्रेश करके दोबारा प्रयास करें।</p>
          ) : office.error ? (
            <p role="alert" className="sp-alert sp-error">
              {office.error}
            </p>
          ) : !office.feed ? (
            <p role="status">
              अवकाश कैलेंडर लोड हो रहा है… / Loading holiday calendar…
            </p>
          ) : closure ? (
            <div role="status" className="sp-alert sp-holiday">
              <h2>अवकाश / Holiday</h2>
              <p translate="no">
                {office.feed.today} • {closure}
              </p>
              <p>
                आज उपस्थिति दर्ज नहीं की जा सकती। / Attendance cannot be
                recorded today.
              </p>
            </div>
          ) : record ? (
            <>
              <div className="sp-record-title">
                <h2>आज की सहेजी गई जानकारी</h2>
                <span className="sp-badge">{phaseLabel(record)}</span>
              </div>
              <RecordDetails row={{ ...record, profiles: profile }} />
              {phase(record) === "draft" ? (
                <div className="sp-finish">
                  <p>
                    आपका इन टाइम सहेजा गया है और प्रशासक को दिखाई देता है।
                    कार्यस्थल छोड़ते समय नीचे दबाएँ।
                  </p>
                  <button
                    className="sp-button sp-primary"
                    disabled={busy}
                    onClick={() => save(undefined, true)}
                  >
                    {busy
                      ? "सहेजा जा रहा है…"
                      : "आउट टाइम सहेजें / Save out time & finish"}
                  </button>
                </div>
              ) : (
                <p className="sp-alert sp-success">
                  आज की उपस्थिति पूरी हो गई है।
                </p>
              )}
            </>
          ) : !assignments.length ? (
            <p className="sp-alert sp-error">
              आपके विभाग, पंचायत और पद का आवंटन उपलब्ध नहीं है। कार्यालय से
              संपर्क करें।
            </p>
          ) : (
            <form onSubmit={(event) => save(event)}>
              <fieldset className="sp-form-controls" disabled={busy}>
                <div className="sp-grid">
                  {hasMultipleWorkspaces ? (
                    <div
                      className="sp-field sp-workspace-picker"
                      role="group"
                      aria-labelledby="workspace-label"
                      aria-required="true"
                    >
                      <strong id="workspace-label">
                        आज का कार्यस्थल / Today’s workspace
                      </strong>
                      <small>
                        केवल एक कार्यस्थल पर टिक करें। दोबारा दबाकर चयन हटा सकते
                        हैं। / Tick one workspace for this attendance. Tap it
                        again to untick.
                      </small>
                      <div className="sp-workspace-options">
                        {workspaceOptions.map((assignment) => {
                          const key = workspaceKey(assignment);
                          return (
                            <label className="sp-workspace-option" key={key}>
                              <input
                                type="checkbox"
                                checked={selectedWorkspaceKey === key}
                                onChange={(event) =>
                                  setSelectedWorkspaceKey(
                                    event.target.checked ? key : "",
                                  )
                                }
                              />
                              <span>
                                <strong translate="no">
                                  {assignment.panchayat}
                                </strong>
                                <small translate="no">
                                  {assignment.department} •{" "}
                                  {assignment.position}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <>
                      <SelectField
                        label="विभाग / Department"
                        value={department}
                        required
                        options={departments}
                        onChange={(value) => {
                          setDepartment(value);
                          setPanchayat("");
                          setPosition("");
                        }}
                      />
                      <SelectField
                        label="पंचायत / Panchayat"
                        value={panchayat}
                        required
                        options={panchayats}
                        onChange={(value) => {
                          setPanchayat(value);
                          setPosition("");
                        }}
                      />
                      <SelectField
                        label="पद / Position"
                        value={position}
                        required
                        options={positions}
                        onChange={setPosition}
                      />
                    </>
                  )}
                  <label className="sp-field">
                    कार्य स्थिति / Work status
                    <select
                      value={status}
                      onChange={(e) => {
                        setStatus(e.target.value);
                        setWorkplacePhoto(null);
                        setCapturedLocation(null);
                        setCameraOpen(false);
                        setLeave(null);
                      }}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {status === "deputation" && (
                    <label className="sp-field">
                      प्रतिनियुक्ति कार्यस्थल का नाम / Workplace name
                      <input
                        required
                        maxLength={200}
                        value={deputation}
                        onChange={(e) => setDeputation(e.target.value)}
                      />
                    </label>
                  )}
                  {(status === "present" || status === "deputation") && (
                    <div className="sp-field" key={status}>
                      <label htmlFor="workplace-photo">
                        कार्यस्थल की फोटो / Workplace photo
                      </label>
                      <input
                        id="workplace-photo"
                        type="file"
                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (
                            file &&
                            (!["image/jpeg", "image/png"].includes(file.type) ||
                              !file.size ||
                              file.size >= 5 * 1024 * 1024)
                          ) {
                            event.target.value = "";
                            setWorkplacePhoto(null);
                            setCapturedLocation(null);
                            fail(
                              new Error(
                                "JPEG/PNG फोटो चुनें, 5 MB से कम। / Choose a JPEG/PNG photo smaller than 5 MB.",
                              ),
                            );
                          } else {
                            setWorkplacePhoto(file || null);
                            setCapturedLocation(null);
                            setCameraOpen(false);
                          }
                        }}
                      />
                      <small>
                        JPEG / PNG • 5 MB से कम / Smaller than 5 MB. या कैमरे से
                        नई फोटो लें / Or take a new photo.
                      </small>
                      <button
                        type="button"
                        className="sp-button sp-secondary"
                        onClick={() => setCameraOpen((open) => !open)}
                      >
                        {cameraOpen
                          ? "कैमरा बंद करें / Close camera"
                          : "कैमरा खोलें / Open camera"}
                      </button>
                      {cameraOpen && (
                        <WorkplaceCamera
                          onClose={() => setCameraOpen(false)}
                          onUse={(file, location) => {
                            setWorkplacePhoto(file);
                            setCapturedLocation(location);
                            const input = document.getElementById(
                              "workplace-photo",
                            ) as HTMLInputElement | null;
                            if (input) input.value = "";
                          }}
                        />
                      )}
                      {photoPreview && (
                        <img
                          className="sp-workplace-preview"
                          src={photoPreview}
                          alt="कार्यस्थल फोटो का पूर्वावलोकन / Workplace photo preview"
                        />
                      )}
                      {capturedLocation && (
                        <small>
                          कैमरा स्थान / Camera location:{" "}
                          {capturedLocation.latitude.toFixed(6)},{" "}
                          {capturedLocation.longitude.toFixed(6)} • ±
                          {Math.round(capturedLocation.accuracy)} m
                        </small>
                      )}
                    </div>
                  )}
                  {status === "absent" && (
                    <label className="sp-field">
                      अनुपस्थिति का कारण / Absence reason
                      <textarea
                        required
                        minLength={3}
                        maxLength={1000}
                        rows={3}
                        value={absenceReason}
                        onChange={(event) =>
                          setAbsenceReason(event.target.value)
                        }
                      />
                    </label>
                  )}
                  {status === "leave" && (
                    <>
                      <label className="sp-field">
                        अवकाश प्रकार / Leave type
                        <select
                          value={leaveType}
                          onChange={(e) => setLeaveType(e.target.value)}
                        >
                          <option value="CL">CL / आकस्मिक अवकाश</option>
                          {profile.gender === "female" && (
                            <option value="SL">SL / बीमारी अवकाश</option>
                          )}
                        </select>
                      </label>
                      <label className="sp-field">
                        CL / SL दस्तावेज़ / Required leave document
                        <input
                          type="file"
                          required
                          accept="image/jpeg,application/pdf,.jpg,.jpeg,.pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (
                              file &&
                              (!["image/jpeg", "application/pdf"].includes(
                                file.type,
                              ) ||
                                !file.size ||
                                file.size >= 5 * 1024 * 1024)
                            ) {
                              e.target.value = "";
                              setLeave(null);
                              fail(
                                new Error(
                                  "JPG या PDF चुनें, 5 MB से कम। / Choose JPG or PDF smaller than 5 MB.",
                                ),
                              );
                            } else setLeave(file || null);
                          }}
                        />
                        <small>
                          JPG या PDF • 5 MB से कम / Smaller than 5 MB
                        </small>
                      </label>
                    </>
                  )}
                </div>
                <label className="sp-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    required
                  />
                  <span>
                    मैं उपस्थिति की जानकारी कार्यालय के प्रशासक के साथ साझा करने
                    की सहमति देता/देती हूँ। कैमरा चुनने पर फोटो और उसका स्थान भी
                    साझा होगा।
                  </span>
                </label>
                <button className="sp-button sp-primary" disabled={busy}>
                  {busy
                    ? "सहेजा जा रहा है…"
                    : status === "present" || status === "deputation"
                      ? "इन टाइम और ड्राफ़्ट सहेजें / Save arrival draft"
                      : "स्थिति सहेजें / Save status"}
                </button>
                <p className="sp-note">
                  समय अपने आप दर्ज होगा।
                  {status === "present" || status === "deputation"
                    ? " ड्राफ़्ट तुरंत प्रशासक को दिखाई देगा।"
                    : " अनुपस्थिति और अवकाश के लिए इन/आउट टाइम नहीं लगेगा।"}
                </p>
              </fieldset>
            </form>
          )}
        </section>
      </>
    </Localized>
  );
}

function Admin({
  fail,
  initial,
  revisions,
  canManage,
  adminBlock,
}: {
  initial?: Bootstrap | null;
  revisions: Revisions | null;
  fail: (err: unknown) => void;
  canManage: boolean;
  adminBlock: string;
}) {
  const office = useOfficeFeed(initial?.office, revisions);
  const [editor, setEditor] = useState<{
    person: Profile | null;
    remove?: boolean;
  } | null>(null);
  const [records, setRecords] = useState<RecordRow[]>(initial?.records || []),
    [staff, setStaff] = useState<Profile[]>(initial?.staff || []);
  const [leaveBalances, setLeaveBalances] =
    useState<LeaveBalanceSnapshot | null>(initial?.leaveBalances || null);
  useEffect(() => {
    if (initial?.leaveBalances) setLeaveBalances(initial.leaveBalances);
  }, [initial?.leaveBalances]);
  const [removedStaff, setRemovedStaff] = useState<Profile[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState("");
  const [date, setDate] = useState(initial?.date || dateToday()),
    [search, setSearch] = useState("");
  const [tab, setTab] = useState("attendance"),
    [loading, setLoading] = useState(!initial),
    [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({
    department: "",
    block: "",
    panchayat: "",
    position: "",
    status: "",
    phase: "",
  });
  const [detail, setDetail] = useState<RecordRow | Profile | null>(null);
  const [file, setFile] = useState<{ url: string; kind: string } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileRequest = useRef(0);
  const requestId = useRef(0),
    alive = useRef(true);
  const retryAdmin = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directoryLoaded = useRef(initial ? Date.now() : 0);
  const skipInitial = useRef(!!initial);
  const load = useCallback(
    async (forceDirectory = false, background = false) => {
      const id = ++requestId.current;
      if (!background) setBusy(true);
      try {
        const includeDirectory =
          forceDirectory ||
          !directoryLoaded.current ||
          (!revisions && Date.now() - directoryLoaded.current > 300000);
        const data = await api(
          `/api/admin?date=${encodeURIComponent(date)}${includeDirectory ? "" : "&directory=0"}`,
        );
        if (alive.current && id === requestId.current) {
          if (retryAdmin.current) clearTimeout(retryAdmin.current);
          setRecords(data.records || []);
          if (data.leaveBalances) setLeaveBalances(data.leaveBalances);
          if (Array.isArray(data.staff)) {
            setStaff(data.staff);
            setRemovedStaff(data.removedStaff || []);
            directoryLoaded.current = Date.now();
          }
        }
      } catch (err) {
        if (alive.current && id === requestId.current) {
          if (
            !background ||
            (err instanceof RequestError && err.status === 401)
          )
            fail(err);
          if (retryAdmin.current) clearTimeout(retryAdmin.current);
          retryAdmin.current = setTimeout(() => {
            if (alive.current && document.visibilityState === "visible")
              void load(forceDirectory, background);
          }, 5000);
        }
      } finally {
        if (alive.current && id === requestId.current) {
          setLoading(false);
          if (!background) setBusy(false);
        }
      }
    },
    [date, fail, !!revisions],
  );
  useEffect(() => {
    alive.current = true;
    if (skipInitial.current) skipInitial.current = false;
    else void load();
    const timer = !revisions
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load(false, true);
        }, 30000)
      : null;
    return () => {
      alive.current = false;
      requestId.current++;
      if (timer) clearInterval(timer);
      if (retryAdmin.current) clearTimeout(retryAdmin.current);
    };
  }, [load]);
  const lastAdminRevisions = useRef({
    directory: revisions?.directory,
    attendance: revisions?.attendance,
    profile: revisions?.profile,
    today: revisions?.today,
  });
  useEffect(() => {
    const prior = lastAdminRevisions.current;
    const directoryChanged =
      prior.directory !== revisions?.directory ||
      prior.profile !== revisions?.profile;
    const attendanceChanged =
      prior.attendance !== revisions?.attendance ||
      prior.profile !== revisions?.profile;
    lastAdminRevisions.current = {
      directory: revisions?.directory,
      attendance: revisions?.attendance,
      profile: revisions?.profile,
      today: revisions?.today,
    };
    if (
      prior.today &&
      revisions?.today &&
      prior.today !== revisions.today &&
      date === prior.today
    ) {
      setDate(revisions.today);
      setRecords([]);
      return;
    }
    if (directoryChanged || attendanceChanged)
      void load(directoryChanged, true);
  }, [
    revisions?.directory,
    revisions?.attendance,
    revisions?.profile,
    revisions?.today,
    date,
    load,
  ]);
  useEffect(() => {
    fileRequest.current++;
    setFileBusy(false);
    if (detail && !dialog.current?.open) dialog.current?.showModal();
    else if (!detail && dialog.current?.open) dialog.current.close();
    setFile(null);
  }, [detail]);
  const normalized = useMemo(() => {
    const people = new Map(staff.map((person) => [person.id, person]));
    return records.map((row) => {
      const livePerson = people.get(row.staff_id) || row.profiles;
      const person =
        livePerson && row.staff_name && row.date !== dateToday()
          ? { ...livePerson, name: row.staff_name }
          : livePerson;
      const current = row.date === dateToday();
      const a = (current ? person?.assignments : row.working_places)?.find(
        (assignment) => assignment.panchayat === row.panchayat,
      );
      return {
        ...row,
        profiles: person,
        block:
          (current ? person?.block : row.block) || row.block || person?.block,
        department:
          (current ? a?.department : row.department) ||
          row.department ||
          a?.department,
        position:
          (current ? a?.position : row.position) || row.position || a?.position,
      };
    });
  }, [records, staff]);
  const recordsByStaff = useMemo(() => {
    const index = new Map<string, typeof normalized>();
    for (const row of normalized)
      index.set(row.staff_id, [...(index.get(row.staff_id) || []), row]);
    return index;
  }, [normalized]);
  const searchMatches = (person?: Profile) =>
    !search.trim() ||
    `${person?.name || ""} ${person?.phone || ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const visibleRecords = normalized.filter(
    (row) =>
      searchMatches(row.profiles) &&
      Object.entries(filters).every(
        ([key, value]) =>
          !value ||
          (key === "phase" ? phase(row) : row[key as keyof RecordRow]) ===
            value,
      ),
  );
  const visibleStaff = (showRemoved ? removedStaff : staff).filter(
    (person) =>
      searchMatches(person) &&
      (person.phone === search.trim() ||
        ((!filters.block || person.block === filters.block) &&
          ((!filters.department && !filters.panchayat && !filters.position) ||
            person.assignments.some(
              (a) =>
                (!filters.department || a.department === filters.department) &&
                (!filters.panchayat || a.panchayat === filters.panchayat) &&
                (!filters.position || a.position === filters.position),
            )))),
  );
  const [page, setPage] = useState(1);
  const totalRows =
    tab === "staff" ? visibleStaff.length : visibleRecords.length;
  const pages = Math.max(1, Math.ceil(totalRows / 25));
  const activePage = Math.min(page, pages);
  useEffect(() => {
    setPage(1);
  }, [search, filters, tab, date]);
  const start = (activePage - 1) * 25;
  const allAssignments = staff.flatMap((person) => person.assignments || []);
  async function openFile(row: RecordRow, kind: string) {
    const fileId = ++fileRequest.current;
    setFileBusy(true);
    setFile(null);
    try {
      const data = await api(
        `/api/files?id=${encodeURIComponent(row.id)}&kind=${kind}`,
      );
      if (alive.current && fileId === fileRequest.current)
        setFile({ url: data.url, kind });
    } catch (err) {
      fail(err);
    } finally {
      if (alive.current && fileId === fileRequest.current) setFileBusy(false);
    }
  }
  function editStaff(person: Profile | null, remove = false) {
    setDetail(null);
    setEditor({ person, remove });
  }
  async function restoreStaff(person: Profile) {
    setBusy(true);
    setRestoreNotice("");
    try {
      await api("/api/staff", { action: "restore", id: person.id });
      setRestoreNotice(
        `${person.name} का खाता बहाल हुआ। / Staff account restored.`,
      );
      setShowRemoved(false);
      await load(true);
    } catch (err) {
      fail(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function filter(key: string, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <Localized>
      <>
        <div className="sp-page-title">
          <div>
            <span className="sp-eyebrow">प्रशासक / ADMIN</span>
            <h1>कर्मी और उपस्थिति</h1>
            <p className="sp-muted">
              आने का ड्राफ़्ट और जाने का समय एक ही जगह देखें।
            </p>
          </div>
          <div className="sp-title-actions">
            {canManage && (
              <button
                className="sp-button sp-primary"
                onClick={() => editStaff(null)}
              >
                कर्मी जोड़ें / Add staff
              </button>
            )}
            <button
              className="sp-button sp-secondary"
              disabled={busy}
              onClick={() => void load(true)}
            >
              {busy ? "लोड हो रहा है…" : "रीफ़्रेश / Refresh"}
            </button>
          </div>
        </div>
        <ReportDownload selectedDate={date} staff={staff} />
        <section className="sp-card">
          <div className="sp-tabs" role="tablist" aria-label="Dashboard view">
            <button
              role="tab"
              aria-selected={tab === "attendance"}
              onClick={() => setTab("attendance")}
            >
              उपस्थिति / Attendance
            </button>
            <button
              role="tab"
              aria-selected={tab === "staff"}
              onClick={() => {
                setTab("staff");
                void load(true);
              }}
            >
              सभी कर्मी / Staff directory
            </button>
            <button
              role="tab"
              aria-selected={tab === "office"}
              onClick={() => setTab("office")}
            >
              अवकाश और सूचनाएँ / Holidays & Notices
            </button>
          </div>
          {tab === "office" ? (
            <OfficeSettings
              feed={office.feed}
              error={office.error}
              reload={office.reload}
              canManage={canManage}
            />
          ) : (
            <>
              {tab === "staff" && canManage && (
                <div
                  className="sp-actions"
                  role="group"
                  aria-label="Staff directory status"
                >
                  <button
                    type="button"
                    className={`sp-button ${showRemoved ? "sp-secondary" : ""}`}
                    aria-pressed={!showRemoved}
                    onClick={() => setShowRemoved(false)}
                  >
                    Current staff ({staff.length})
                  </button>
                  <button
                    type="button"
                    className={`sp-button ${showRemoved ? "" : "sp-secondary"}`}
                    aria-pressed={showRemoved}
                    onClick={() => setShowRemoved(true)}
                  >
                    Removed staff ({removedStaff.length})
                  </button>
                </div>
              )}
              {restoreNotice && (
                <p role="status" className="sp-alert sp-success">
                  {restoreNotice}
                </p>
              )}
              {office.feed && officeClosure(date, office.feed.holidays) && (
                <p className="sp-alert sp-holiday">
                  अवकाश / Holiday ({officeClosure(date, office.feed.holidays)})
                </p>
              )}
              <div className="sp-filters">
                <label className="sp-field sp-search">
                  कर्मी खोजें / Search staff
                  <input
                    type="search"
                    placeholder="नाम या मोबाइल नंबर / Name or mobile"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {tab === "attendance" && (
                  <label className="sp-field">
                    तारीख / Date
                    <input
                      type="date"
                      value={date}
                      required
                      onChange={(e) => {
                        if (e.target.value) {
                          setDate(e.target.value);
                          setRecords([]);
                          setLoading(true);
                        }
                      }}
                    />
                  </label>
                )}
                <SelectField
                  label="विभाग / Department"
                  value={filters.department}
                  onChange={(v) => filter("department", v)}
                  options={unique([
                    ...allAssignments.map((a) => a.department),
                    ...normalized.map((r) => r.department),
                  ])}
                />
                <SelectField
                  label="प्रखंड / Block"
                  value={filters.block}
                  onChange={(v) => filter("block", v)}
                  options={unique(staff.map((p) => p.block))}
                />
                <SelectField
                  label="पंचायत / Panchayat"
                  value={filters.panchayat}
                  onChange={(v) => filter("panchayat", v)}
                  options={unique([
                    ...allAssignments.map((a) => a.panchayat),
                    ...normalized.map((r) => r.panchayat),
                  ])}
                />
                <SelectField
                  label="पद / Position"
                  value={filters.position}
                  onChange={(v) => filter("position", v)}
                  options={unique([
                    ...allAssignments.map((a) => a.position),
                    ...normalized.map((r) => r.position),
                  ])}
                />
                {tab === "attendance" && (
                  <>
                    <label className="sp-field">
                      स्थिति / Status
                      <select
                        value={filters.status}
                        onChange={(e) => filter("status", e.target.value)}
                      >
                        <option value="">सभी / All</option>
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sp-field">
                      ड्राफ़्ट / पूर्ण
                      <select
                        value={filters.phase}
                        onChange={(e) => filter("phase", e.target.value)}
                      >
                        <option value="">सभी / All</option>
                        <option value="draft">कार्यस्थल पर / Draft</option>
                        <option value="completed">सहेजा गया / Saved</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              <div className="sp-list-caption">
                <p>
                  {tab === "attendance"
                    ? `${visibleRecords.length} उपस्थिति रिकॉर्ड`
                    : `${visibleStaff.length} ${showRemoved ? "हटाए गए कर्मी / Removed staff" : "कर्मी"}`}
                </p>
                <button
                  className="sp-text-button"
                  onClick={() => {
                    setSearch("");
                    setFilters({
                      department: "",
                      block: "",
                      panchayat: "",
                      position: "",
                      status: "",
                      phase: "",
                    });
                  }}
                >
                  फ़िल्टर हटाएँ / Clear filters
                </button>
              </div>
              {loading ? (
                <p role="status" className="sp-empty">
                  जानकारी लोड हो रही है…
                </p>
              ) : tab === "attendance" ? (
                visibleRecords.length ? (
                  <div className="sp-table-scroll">
                    <table className="sp-table sp-attendance-table">
                      <thead>
                        <tr>
                          <th scope="col">कर्मी / Staff</th>
                          <th scope="col">पंचायत / Panchayat</th>
                          <th scope="col">स्थिति / Status</th>
                          <th scope="col">इन / In</th>
                          <th scope="col">आउट / Out</th>
                          <th scope="col">विवरण / Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRecords.slice(start, start + 25).map((row) => (
                          <tr key={row.id}>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                कर्मी / Staff
                              </span>
                              <div className="sp-cell-value">
                                <strong translate="no">
                                  {row.profiles?.name || "कर्मी"}
                                </strong>
                                <small>
                                  {row.profiles?.phone || ""} •{" "}
                                  {row.position || ""}
                                </small>
                              </div>
                            </td>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                पंचायत / Panchayat
                              </span>
                              <div className="sp-cell-value">
                                {row.panchayat}
                                <small>
                                  {row.department || ""} • {row.block || ""}
                                </small>
                              </div>
                            </td>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                स्थिति / Status
                              </span>
                              <div className="sp-cell-value">
                                {statusLabels[row.status] || row.status}
                                <small
                                  className={
                                    phase(row) === "draft" ? "sp-draft" : ""
                                  }
                                >
                                  {phaseLabel(row)}
                                </small>
                              </div>
                            </td>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                इन / In
                              </span>
                              <div className="sp-cell-value">
                                {time(row.time_in)}
                              </div>
                            </td>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                आउट / Out
                              </span>
                              <div className="sp-cell-value">
                                {time(row.time_out)}
                              </div>
                            </td>
                            <td>
                              <span
                                className="sp-cell-label"
                                aria-hidden="true"
                              >
                                विवरण / Details
                              </span>
                              <div className="sp-cell-value">
                                <div className="sp-actions">
                                  <button
                                    className="sp-button sp-secondary"
                                    onClick={() => setDetail(row)}
                                    aria-label={`${row.profiles?.name || "कर्मी"} का विवरण`}
                                  >
                                    देखें / View
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="sp-empty">
                    इस तारीख और फ़िल्टर के लिए उपस्थिति नहीं है। सभी कर्मी देखने
                    के लिए Staff directory खोलें।
                  </p>
                )
              ) : visibleStaff.length ? (
                <div className="sp-table-scroll">
                  <table className="sp-table sp-directory-table">
                    <thead>
                      <tr>
                        <th scope="col">कर्मी / Staff</th>
                        <th scope="col">प्रखंड / Block</th>
                        <th scope="col">विभाग, पंचायत और पद / Assignment</th>
                        <th scope="col">उपस्थिति / Attendance ({date})</th>
                        <th scope="col">अवकाश शेष / Leave left</th>
                        <th scope="col">विवरण / Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStaff.slice(start, start + 25).map((person) => (
                        <tr key={person.id}>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              कर्मी / Staff
                            </span>
                            <div className="sp-cell-value">
                              <strong translate="no">{person.name}</strong>
                              <small>{person.phone}</small>
                              {!person.active && (
                                <small>
                                  {person.deleted_at
                                    ? "हटाया गया / Removed"
                                    : "निष्क्रिय / Inactive"}
                                </small>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              प्रखंड / Block
                            </span>
                            <div className="sp-cell-value">{person.block}</div>
                          </td>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              विभाग, पंचायत और पद / Assignment
                            </span>
                            <div className="sp-cell-value">
                              {person.assignments.map((a, i) => (
                                <small key={i}>
                                  {a.department} • {a.panchayat} • {a.position}
                                </small>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              उपस्थिति / Attendance
                            </span>
                            <div className="sp-cell-value">
                              {recordsByStaff.has(person.id)
                                ? recordsByStaff.get(person.id)!.map((row) => (
                                    <small key={row.id}>
                                      {statusLabels[row.status] || row.status} •{" "}
                                      {phaseLabel(row)}
                                    </small>
                                  ))
                                : "दर्ज नहीं / Not recorded"}
                            </div>
                          </td>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              अवकाश शेष / Leave left
                            </span>
                            <div className="sp-cell-value">
                              <LeaveBalanceDisplay
                                balance={leaveBalances?.balances.find(
                                  (entry) => entry.staff_id === person.id,
                                )}
                                gender={person.gender}
                              />
                            </div>
                          </td>
                          <td>
                            <span className="sp-cell-label" aria-hidden="true">
                              विवरण / Details
                            </span>
                            <div className="sp-cell-value">
                              <div className="sp-actions">
                                <button
                                  type="button"
                                  className="sp-button sp-secondary"
                                  onClick={() => setDetail(person)}
                                  aria-label={`${person.name} का विवरण`}
                                >
                                  देखें / View
                                </button>
                                {canManage && (
                                  <>
                                    {person.deleted_at ? (
                                      <button
                                        type="button"
                                        className="sp-button sp-secondary"
                                        disabled={busy}
                                        onClick={() =>
                                          void restoreStaff(person)
                                        }
                                      >
                                        बहाल करें / Restore
                                      </button>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          className="sp-button sp-secondary"
                                          onClick={() => editStaff(person)}
                                        >
                                          बदलें / Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="sp-button sp-secondary"
                                          onClick={() =>
                                            editStaff(person, true)
                                          }
                                        >
                                          हटाएँ / Remove
                                        </button>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="sp-empty">
                  कोई कर्मी नहीं मिला। खोज या फ़िल्टर बदलें।
                  {!showRemoved &&
                    canManage &&
                    " हटाए गए कर्मी देखने के लिए Removed staff चुनें।"}
                </p>
              )}
              {pages > 1 && (
                <nav className="sp-pagination" aria-label="Staff list pages">
                  <button
                    type="button"
                    className="sp-button sp-secondary"
                    disabled={activePage <= 1}
                    onClick={() => setPage(activePage - 1)}
                  >
                    पिछला / Previous
                  </button>
                  <span>
                    {start + 1}–{Math.min(start + 25, totalRows)} / {totalRows}
                  </span>
                  <button
                    type="button"
                    className="sp-button sp-secondary"
                    disabled={activePage >= pages}
                    onClick={() => setPage(activePage + 1)}
                  >
                    अगला / Next
                  </button>
                </nav>
              )}
              <p className="sp-note">जानकारी हर 30 सेकंड में अपडेट होती है।</p>
            </>
          )}
        </section>
        <dialog
          ref={dialog}
          className="sp-dialog"
          onCancel={() => setDetail(null)}
          onClose={() => {
            setDetail(null);
            setFile(null);
          }}
          aria-labelledby="staff-detail-title"
        >
          <div className="sp-dialog-header">
            <h2 id="staff-detail-title" translate="no">
              {(detail &&
                ("staff_id" in detail ? detail.profiles?.name : detail.name)) ||
                "कर्मी विवरण"}
            </h2>
            <button
              className="sp-button sp-secondary"
              onClick={() => setDetail(null)}
            >
              बंद करें / Close
            </button>
          </div>
          {detail && !("staff_id" in detail) && canManage && (
            <div className="sp-actions">
              <button
                className="sp-button sp-secondary"
                onClick={() => editStaff(detail)}
              >
                कर्मी विवरण बदलें / Edit staff
              </button>
              <button
                className="sp-button sp-secondary"
                onClick={() => editStaff(detail, true)}
              >
                कर्मी हटाएँ / Remove staff
              </button>
            </div>
          )}
          {detail &&
            ("staff_id" in detail ? (
              <>
                <p>
                  {detail.date} • {phaseLabel(detail)}
                </p>
                <RecordDetails row={detail} showCameraLocation={false} />
                <SavedAttendanceEvidence key={detail.id} row={detail} />
                <div className="sp-actions">
                  {detail.leave_path && (
                    <button
                      className="sp-button sp-secondary"
                      disabled={fileBusy}
                      onClick={() => openFile(detail, "leave_path")}
                    >
                      अवकाश दस्तावेज़ देखें
                    </button>
                  )}
                </div>
                {fileBusy && <p role="status">फ़ाइल खुल रही है…</p>}
                {file && (
                  <p className="sp-alert">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sp-file-link"
                    >
                      {file.kind === "photo_path"
                        ? "कार्यस्थल फोटो खोलें / Open workplace photo"
                        : "दस्तावेज़ खोलें / Open document"}
                    </a>
                    <small>सुरक्षित लिंक 60 सेकंड तक मान्य है।</small>
                  </p>
                )}
              </>
            ) : (
              <>
                <dl className="sp-details">
                  <div>
                    <dt>मोबाइल / Mobile</dt>
                    <dd>{detail.phone}</dd>
                  </div>
                  <div>
                    <dt>प्रखंड / Block</dt>
                    <dd>{detail.block}</dd>
                  </div>
                  <div>
                    <dt>ईमेल / Email</dt>
                    <dd>{detail.email || "—"}</dd>
                  </div>
                  <div>
                    <dt>लिंग / Gender</dt>
                    <dd>
                      {detail.gender === "female"
                        ? "महिला / Female"
                        : detail.gender === "male"
                          ? "पुरुष / Male"
                          : "दर्ज नहीं / Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      अवकाश शेष / Leave left ({leaveBalances?.year || "—"})
                    </dt>
                    <dd>
                      <LeaveBalanceDisplay
                        balance={leaveBalances?.balances.find(
                          (entry) => entry.staff_id === detail.id,
                        )}
                        gender={detail.gender}
                      />
                    </dd>
                  </div>
                </dl>
                <h3>आवंटन / Assignments</h3>
                {detail.assignments.map((a, i) => (
                  <p key={i}>
                    {a.department} • {a.panchayat} • {a.position}
                  </p>
                ))}
              </>
            ))}
        </dialog>
        {editor && (
          <StaffEditor
            block={adminBlock}
            person={editor.person}
            remove={editor.remove}
            staff={staff}
            onClose={() => setEditor(null)}
            onFound={(phone, removed) => {
              setEditor(null);
              setTab("staff");
              setShowRemoved(removed);
              setSearch(phone);
              setFilters({
                department: "",
                block: "",
                panchayat: "",
                position: "",
                status: "",
                phase: "",
              });
              void load(true);
            }}
            onSaved={(saved, removedId) => {
              if (removedId)
                setStaff((previous) =>
                  previous.filter((person) => person.id !== removedId),
                );
              else if (saved)
                setStaff((previous) =>
                  [
                    ...previous.filter((person) => person.id !== saved.id),
                    saved,
                  ].sort((a, b) => a.name.localeCompare(b.name)),
                );
              void load(true);
            }}
          />
        )}
      </>
    </Localized>
  );
}
