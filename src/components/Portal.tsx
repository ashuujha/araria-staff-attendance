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
import { uploadWithProgress } from "../lib/upload-progress";
import { staffLeaveBalance } from "../lib/staff-leave-balance";
import {
  googleMapsUrl,
  openStreetMapEmbedUrl,
  type CameraLocation,
} from "../lib/osm-camera";
import { PANCHAYATI_RAJ_DEPARTMENT } from "../lib/district";
import {
  directoryChoices,
  filterDirectoryStaff,
  matchingAssignments,
  type DirectoryFilters,
} from "../lib/staff-directory";

const AdminCaptcha = dynamic(() => import("./AdminCaptcha"));
const WorkplaceCamera = dynamic(() => import("./WorkplaceCamera"));
const ReportDownload = dynamic(() => import("./ReportDownload"));
const LeaveDecisionDialog = dynamic(() => import("./LeaveDecisionDialog"));
const StaffEditor = dynamic(() => import("./StaffEditor"));

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
  out_photo_path?: string | null;
  out_location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null;
  leave_path?: string | null;
  profiles?: Profile;
  working_places?: Assignment[];
};
type LeaveApplication = {
  id: string;
  staff_id?: string;
  staff_name?: string;
  block_id?: string;
  blocks?: { name_en: string };
  date: string;
  panchayat: string;
  position: string;
  leave_type: "CL" | "SL" | "MATERNITY" | "PATERNITY" | "OTHER";
  leave_detail?: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at?: string | null;
  leave_path?: string;
  decision_document_path?: string | null;
  decision_method?: "drawn" | "uploaded" | null;
  rejection_reason?: string | null;
  decided_by?: string | null;
  decider?: { name: string; role: string } | null;
};
type LeaveStaffDetails = {
  staff: Profile & { secondary_phones?: string[] };
  attendance: {
    date: string;
    status: string;
    phase?: string;
    panchayat: string;
    position: string;
    time_in: string | null;
    time_out: string | null;
    leave_type?: string | null;
  }[];
  leaveHistory: LeaveApplication[];
  leaveBalance: LeaveBalance | null;
  balanceYear: number | null;
  today: string;
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
async function sendLeaveDecision(form: FormData) {
  const response = await fetch("/api/leave-applications", {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      data.error || "Leave decision failed.",
      response.status,
    );
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
  on_duty: "ड्यूटी पर / On Duty",
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
    ["प्रखंड / Block", row.block || row.profiles?.block],
    ["पंचायत / Panchayat", row.panchayat],
    ["पद / Position", row.position || assignment?.position],
    ["स्थिति / Status", statusLabels[row.status] || row.status],
    ["ड्यूटी स्थान / Duty location", row.deputation_workplace],
    ["अवकाश / Leave", row.leave_type],
    [
      row.status === "on_duty"
        ? "ड्यूटी का कारण / On-duty reason"
        : "अनुपस्थिति का कारण / Absence reason",
      row.absence_reason,
    ],
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
                      "प्रखंड / Block",
                      "पंचायत / Panchayat",
                      "पद / Position",
                      "ड्यूटी स्थान / Duty location",
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
                href={googleMapsUrl({
                  latitude: row.latitude!,
                  longitude: row.longitude!,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps में स्थान देखें / View location on Google Maps
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
              href={googleMapsUrl(coordinates)}
              target="_blank"
              rel="noopener noreferrer"
              className="sp-button sp-secondary"
            >
              Google Maps में स्थान देखें / View location on Google Maps
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

function SavedDepartureEvidence({ row }: { row: RecordRow }) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!row.out_photo_path) return;
    let cancelled = false;
    setPhotoUrl("");
    setError("");
    void api(`/api/files?id=${encodeURIComponent(row.id)}&kind=out_photo_path`)
      .then((result) => {
        if (!cancelled) setPhotoUrl(result.url);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Departure photo unavailable",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [row.id, row.out_photo_path, refresh]);
  if (!row.out_photo_path) return null;
  const location = row.out_location;
  const hasLocation =
    location &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude);
  return (
    <section
      className="sp-saved-gps"
      aria-label="Departure GPS photo and location"
    >
      <h3>जाने के समय की GPS फोटो / Departure GPS photo</h3>
      {photoUrl ? (
        <a href={photoUrl} target="_blank" rel="noopener noreferrer">
          <img
            className="sp-saved-photo"
            src={photoUrl}
            alt="Staff departure photo with GPS and time stamp"
            onError={() => {
              setPhotoUrl("");
              setError("Photo link expired. Reload it.");
            }}
          />
        </a>
      ) : error ? (
        <p role="alert" className="sp-alert sp-error">
          {error}
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
      {hasLocation && (
        <p className="sp-note">
          Departure location: {location.latitude.toFixed(6)},{" "}
          {location.longitude.toFixed(6)}
          {Number.isFinite(location.accuracy) &&
            ` • ±${Math.round(location.accuracy!)} m`}{" "}
          <a
            href={googleMapsUrl({
              latitude: location.latitude,
              longitude: location.longitude,
            })}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Google Maps
          </a>
        </p>
      )}
    </section>
  );
}

export default function Portal({
  loginRole = "staff",
}: {
  loginRole?: "staff" | "bpro" | "dpro";
}) {
  const adminLogin = loginRole !== "staff";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [revisions, setRevisions] = useState<Revisions | null>(null);
  const revisionRef = useRef<Revisions | null>(null);
  const [activeDepartment, setActiveDepartment] = useState("");
  useEffect(() => {
    setActiveDepartment("");
  }, [profile?.id]);
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
          if (data.profile.role !== loginRole) {
            window.location.replace(
              data.profile.role === "staff" ? "/" : `/${data.profile.role}`,
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
  }, [fail, loginRole]);
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
        role: loginRole,
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
    if (!profile) return;
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
            if (data.profile.role !== loginRole) {
              window.location.replace(
                data.profile.role === "staff" ? "/" : `/${data.profile.role}`,
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
    visible();
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
  }, [profile?.id, loginRole]);
  return (
    <Localized>
      <div className="simple-portal">
        <header
          className={
            profile ? "sp-header sp-header-authenticated" : "sp-header"
          }
        >
          <DepartmentBrand
            key={profile?.id || "public"}
            profile={profile}
            selected={activeDepartment}
            loginRole={loginRole}
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
                  ? loginRole === "bpro"
                    ? "प्रखंड पंचायती राज पदाधिकारी / BPRO login"
                    : "जिला पंचायती राज पदाधिकारी / DPRO login"
                  : "कर्मी लॉगिन / Staff login"}
              </h1>
              <p className="sp-muted">अपना लॉगिन विवरण और पासवर्ड डालें।</p>
              <form onSubmit={login}>
                <label className="sp-field">
                  {adminLogin ? "ईमेल / Email" : "मोबाइल नंबर / Mobile number"}
                  <input
                    required
                    type={adminLogin ? "email" : "tel"}
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
              canManage
              adminBlock={profile.block}
              role={profile.role as "bpro" | "dpro"}
              adminBlockId={profile.block_id}
            />
          )}
        </main>
        <footer className="sp-footer">
          <span>अररिया • कर्मचारी उपस्थिति पोर्टल</span>
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
  const office = useOfficeFeed(initial?.office, revisions, false);
  const closure = office.feed
    ? officeClosure(office.feed.today, office.feed.holidays)
    : null;
  const [record, setRecord] = useState<RecordRow | null>(
    initial?.records[0] || null,
  );
  const [leaveApplication, setLeaveApplication] =
    useState<LeaveApplication | null>(null);
  const [leaveHistory, setLeaveHistory] = useState<LeaveApplication[]>([]);
  const [leaveUsage, setLeaveUsage] = useState<
    { date: string; leave_type: string | null }[]
  >([]);
  const [leaveHistoryLoading, setLeaveHistoryLoading] = useState(true);
  const [leaveHistoryError, setLeaveHistoryError] = useState("");
  const [staffDecisionLinks, setStaffDecisionLinks] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(!initial),
    [busy, setBusy] = useState(false);
  const [saveProgress, setSaveProgress] = useState("");
  const [loadError, setLoadError] = useState(false);
  const department = PANCHAYATI_RAJ_DEPARTMENT;
  const [panchayat, setPanchayat] = useState(""),
    [position, setPosition] = useState("");
  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState("");
  const [status, setStatus] = useState("present"),
    [deputation, setDeputation] = useState(""),
    [leaveType, setLeaveType] = useState("CL");
  const [dutyReason, setDutyReason] = useState("");
  const [leaveDetail, setLeaveDetail] = useState("");
  const savingRef = useRef(false);
  useEffect(() => {
    if (profile.gender !== "female" && leaveType === "SL") setLeaveType("CL");
  }, [profile.gender, leaveType]);
  const [workplacePhoto, setWorkplacePhoto] = useState<File | null>(null);
  const [capturedLocation, setCapturedLocation] =
    useState<CameraLocation | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [departurePhoto, setDeparturePhoto] = useState<File | null>(null);
  const [departureLocation, setDepartureLocation] =
    useState<CameraLocation | null>(null);
  const [departureCameraOpen, setDepartureCameraOpen] = useState(false);
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
  const [departurePreview, setDeparturePreview] = useState("");
  useEffect(() => {
    if (!departurePhoto) {
      setDeparturePreview("");
      return;
    }
    const url = URL.createObjectURL(departurePhoto);
    setDeparturePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [departurePhoto]);
  const [leave, setLeave] = useState<File | null>(null),
    [consent, setConsent] = useState(false);
  const alive = useRef(true);
  const staffRequestId = useRef(0);
  const initialLoadPending = useRef(!initial);
  const retryLoad = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignments = (profile.assignments || []).filter(
    (a) => a.panchayat?.trim() && a.position?.trim(),
  );
  const workspaceKey = (a: Assignment) =>
    JSON.stringify([a.panchayat, a.position]);
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
  useEffect(
    () => onDepartmentChange(department),
    [onDepartmentChange, department],
  );
  const panchayats = unique(assignments.map((a) => a.panchayat));
  const positions = unique(
    assignments.filter((a) => a.panchayat === panchayat).map((a) => a.position),
  );
  const load = useCallback(
    async (background = false) => {
      const requestId = ++staffRequestId.current;
      if (!background) setLoading(true);
      try {
        const data = await api("/api/attendance-workflow");
        if (alive.current && requestId === staffRequestId.current) {
          if (data.office) office.accept(data.office);
          if (retryLoad.current) clearTimeout(retryLoad.current);
          setRecord(
            (data.records || []).find(
              (row: RecordRow) => row.date === dateToday(),
            ) || null,
          );
          setLeaveApplication(data.application || null);
          setLoadError(false);
          initialLoadPending.current = false;
        }
      } catch (err) {
        if (alive.current && requestId === staffRequestId.current) {
          if (
            !background ||
            initialLoadPending.current ||
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
        if (alive.current && requestId === staffRequestId.current)
          setLoading(false);
      }
    },
    [fail, office.accept],
  );
  useEffect(() => {
    alive.current = true;
    if (!initial) void load();
    else
      void api("/api/leave-applications")
        .then((data) => {
          if (alive.current) setLeaveApplication(data.application || null);
        })
        .catch(fail);
    return () => {
      alive.current = false;
      staffRequestId.current++;
      if (retryLoad.current) clearTimeout(retryLoad.current);
    };
  }, [load, initial]);
  useEffect(() => {
    if (leaveApplication?.status !== "pending") return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void api("/api/leave-applications")
        .then((data) => {
          if (!alive.current) return;
          setLeaveApplication(data.application || null);
          if (data.application?.status === "approved") void load(true);
        })
        .catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [leaveApplication?.status, load]);
  useEffect(() => {
    setLeaveHistoryLoading(true);
    void api("/api/leave-applications?view=history")
      .then((data) => {
        if (alive.current) {
          setLeaveHistory(data.history || []);
          setLeaveUsage(data.leaveUsage || []);
          setLeaveHistoryError("");
        }
      })
      .catch(() => {
        if (alive.current)
          setLeaveHistoryError(
            "अवकाश इतिहास लोड नहीं हुआ। रीफ़्रेश करें। / Leave history could not load. Refresh.",
          );
      })
      .finally(() => {
        if (alive.current) setLeaveHistoryLoading(false);
      });
  }, [leaveApplication?.status, revisions?.attendance]);
  async function showStaffDecision(id: string) {
    try {
      const result = await api(
        `/api/files?id=${encodeURIComponent(id)}&kind=decision_document_path`,
      );
      setStaffDecisionLinks((current) => ({ ...current, [id]: result.url }));
    } catch (error) {
      fail(error);
    }
  }
  const lastAttendanceRevision = useRef({
    attendance: revisions?.attendance,
    today: revisions?.today,
  });
  useEffect(() => {
    const prior = lastAttendanceRevision.current;
    const firstRevision =
      prior.attendance === undefined && prior.today === undefined;
    if (
      prior.attendance !== revisions?.attendance ||
      prior.today !== revisions?.today
    ) {
      lastAttendanceRevision.current = {
        attendance: revisions?.attendance,
        today: revisions?.today,
      };
      if (!firstRevision) void load(true);
    }
  }, [revisions?.attendance, revisions?.today, load]);
  useEffect(() => {
    if (panchayat && !panchayats.includes(panchayat)) {
      setPanchayat("");
      setPosition("");
    } else if (position && !positions.includes(position)) setPosition("");
  }, [profile.assignments, panchayats, positions, panchayat, position, notify]);
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
    setSaveProgress("फ़ोटो तैयार हो रही है… / Preparing file…");
    // The built-in camera already creates a bounded JPEG. Avoid decoding and
    // encoding the geotagged photo for a second time on a mobile device.
    if (
      (purpose === "workplace_photo" || purpose === "departure_photo") &&
      !(
        file instanceof File &&
        file.name.startsWith("araria-workplace-") &&
        file.type === "image/jpeg"
      )
    )
      file = await prepareWorkplacePhoto(file);
    setSaveProgress(
      "सुरक्षित अपलोड तैयार हो रहा है… / Preparing secure upload…",
    );
    const signed = await api("/api/upload", {
      type: file.type,
      size: file.size,
      purpose,
    });
    await uploadWithProgress(signed.url, file, (percent) => {
      if (alive.current)
        setSaveProgress(`फ़ाइल अपलोड हो रही है… / Uploading file… ${percent}%`);
    });
    return signed.path;
  }
  async function save(event?: React.FormEvent, complete = false) {
    event?.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setSaveProgress("");
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
          : ["present", "deputation", "on_duty"].includes(status)
            ? "save_draft"
            : "save_status",
        panchayat: selectedWorkspace?.panchayat || panchayat,
        department: selectedWorkspace?.department || department,
        position: selectedWorkspace?.position || position,
        status,
        deputation_workplace:
          status === "deputation" || status === "on_duty"
            ? deputation.trim()
            : null,
        leave_type: status === "leave" ? leaveType : null,
        leave_detail: status === "leave" ? leaveDetail.trim() : null,
        absence_reason:
          status === "absent"
            ? absenceReason.trim()
            : status === "on_duty"
              ? dutyReason.trim()
              : null,
      };
      if (complete) {
        body.id = record?.id;
        if (
          !departurePhoto ||
          !departureLocation ||
          departurePhoto.type !== "image/jpeg" ||
          !departurePhoto.size ||
          departurePhoto.size >= 5 * 1024 * 1024
        )
          throw new Error(
            "आउट समय के लिए नई GPS फोटो लें (5 MB से कम)। / Take a fresh departure GPS photo under 5 MB.",
          );
        body.photo_upload_path = await upload(
          departurePhoto,
          "departure_photo",
        );
        body.latitude = departureLocation.latitude;
        body.longitude = departureLocation.longitude;
        body.accuracy = departureLocation.accuracy;
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
        if (["present", "deputation", "on_duty"].includes(status)) {
          if (
            !workplacePhoto ||
            !["image/jpeg", "image/png"].includes(workplacePhoto.type) ||
            !workplacePhoto.size ||
            workplacePhoto.size >= 5 * 1024 * 1024
          )
            throw new Error(
              "GPS कैमरे से फोटो लें, 5 MB से कम। / Take a GPS camera photo smaller than 5 MB.",
            );
          body.photo_upload_path = await upload(
            workplacePhoto,
            "workplace_photo",
          );
          if (capturedLocation) {
            body.latitude = capturedLocation.latitude;
            body.longitude = capturedLocation.longitude;
            body.accuracy = capturedLocation.accuracy;
          } else
            throw new Error(
              "GPS camera location is required. Take a fresh photo.",
            );
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
      setSaveProgress("उपस्थिति दर्ज हो रही है… / Saving attendance…");
      const saved = await api("/api/attendance-workflow", body);
      if (!alive.current) return;
      if (saved.application?.id) {
        staffRequestId.current++;
        setLeaveApplication(saved.application);
        setLoading(false);
        setLoadError(false);
        setLeave(null);
        notify(
          "अवकाश आवेदन भेजा गया है। BPRO और DPRO के निर्णय की प्रतीक्षा करें। / Leave application sent for approval.",
        );
        return;
      }
      if (!saved.record?.id)
        throw new Error(
          "सहेजी गई उपस्थिति नहीं मिली। रीफ़्रेश करें। / Saved attendance not returned. Refresh to confirm.",
        );
      staffRequestId.current++;
      setRecord(saved.record);
      setLoading(false);
      setLoadError(false);
      setLeave(null);
      setWorkplacePhoto(null);
      setCapturedLocation(null);
      setCameraOpen(false);
      setDeparturePhoto(null);
      setDepartureLocation(null);
      setDepartureCameraOpen(false);
      notify(
        complete
          ? "जाने का समय सहेज दिया गया।"
          : "उपस्थिति सहेज दी गई। प्रशासक इसे देख सकते हैं।",
      );
    } catch (err) {
      if (alive.current) fail(err);
    } finally {
      savingRef.current = false;
      if (alive.current) {
        setBusy(false);
        setSaveProgress("");
      }
    }
  }
  const today = dateToday();
  const yearLeaves = leaveUsage.filter((entry) =>
    entry.date.startsWith(today.slice(0, 4)),
  );
  const staffBalance = staffLeaveBalance(profile, leaveUsage, today);
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
                    कार्यस्थल छोड़ते समय नई GPS फोटो लें, फिर आउट टाइम सहेजें।
                  </p>
                  <button
                    type="button"
                    className="sp-button sp-secondary"
                    disabled={busy}
                    onClick={() => setDepartureCameraOpen((open) => !open)}
                  >
                    {departureCameraOpen
                      ? "कैमरा बंद करें / Close camera"
                      : "आउट समय की GPS फोटो लें / Take departure GPS photo"}
                  </button>
                  {departureCameraOpen && (
                    <WorkplaceCamera
                      mode="departure"
                      onClose={() => setDepartureCameraOpen(false)}
                      onUse={(file, location) => {
                        setDeparturePhoto(file);
                        setDepartureLocation(location);
                      }}
                    />
                  )}
                  {departurePreview && departureLocation && (
                    <div className="sp-camera-review">
                      <img
                        className="sp-camera"
                        src={departurePreview}
                        alt="Departure GPS camera photo preview"
                      />
                      <p>
                        Departure location:{" "}
                        {departureLocation.latitude.toFixed(6)},{" "}
                        {departureLocation.longitude.toFixed(6)} • ±
                        {Math.round(departureLocation.accuracy)} m
                      </p>
                    </div>
                  )}
                  <button
                    className="sp-button sp-primary"
                    disabled={busy || !departurePhoto || !departureLocation}
                    onClick={() => save(undefined, true)}
                  >
                    {busy
                      ? "सहेजा जा रहा है…"
                      : "GPS फोटो सहित आउट टाइम सहेजें / Save out time with GPS photo"}
                  </button>
                  {busy && saveProgress && (
                    <p role="status" aria-live="polite" className="sp-note">
                      {saveProgress}
                    </p>
                  )}
                </div>
              ) : (
                <p className="sp-alert sp-success">
                  आज की उपस्थिति पूरी हो गई है।
                </p>
              )}
            </>
          ) : leaveApplication?.status === "pending" ? (
            <div role="status" className="sp-alert sp-holiday">
              <h2>अवकाश आवेदन लंबित / Leave application pending</h2>
              <p>
                {leaveApplication.leave_type} • {leaveApplication.date} •{" "}
                {leaveApplication.panchayat}
              </p>
              <p>
                BPRO या DPRO के निर्णय के बाद अवकाश दर्ज होगा और शेष अवकाश
                बदलेगा।
              </p>
            </div>
          ) : !assignments.length ? (
            <p className="sp-alert sp-error">
              आपके विभाग, पंचायत और पद का आवंटन उपलब्ध नहीं है। कार्यालय से
              संपर्क करें।
            </p>
          ) : (
            <>
              {leaveApplication?.status === "rejected" && (
                <p role="status" className="sp-alert sp-error">
                  पिछला अवकाश आवेदन अस्वीकृत हुआ। आप सही जानकारी के साथ फिर
                  आवेदन कर सकते हैं।{" "}
                  {leaveApplication.rejection_reason && (
                    <>कारण / Reason: {leaveApplication.rejection_reason}.</>
                  )}{" "}
                  / The previous leave request was rejected; you may apply
                  again.
                </p>
              )}
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
                          केवल एक कार्यस्थल पर टिक करें। दोबारा दबाकर चयन हटा
                          सकते हैं। / Tick one workspace for this attendance.
                          Tap it again to untick.
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
                    <fieldset className="sp-status-group">
                      <legend>कार्य स्थिति / Work status</legend>
                      <div className="sp-status-options">
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <label className="sp-status-option" key={value}>
                            <input
                              type="radio"
                              name="work-status"
                              value={value}
                              checked={status === value}
                              onChange={() => {
                                setStatus(value);
                                setWorkplacePhoto(null);
                                setCapturedLocation(null);
                                setCameraOpen(false);
                                setLeave(null);
                              }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      <small className="sp-status-hint">
                        ← Swipe to see all work statuses →
                      </small>
                    </fieldset>
                    {(status === "deputation" || status === "on_duty") && (
                      <label className="sp-field">
                        ड्यूटी स्थान / Duty location
                        <input
                          required
                          maxLength={200}
                          value={deputation}
                          onChange={(e) => setDeputation(e.target.value)}
                        />
                      </label>
                    )}
                    {status === "on_duty" && (
                      <label className="sp-field">
                        ड्यूटी का कारण / On-duty reason
                        <textarea
                          required
                          minLength={3}
                          maxLength={1000}
                          rows={3}
                          value={dutyReason}
                          onChange={(event) =>
                            setDutyReason(event.target.value)
                          }
                        />
                      </label>
                    )}
                    {["present", "deputation", "on_duty"].includes(status) && (
                      <div className="sp-field" key={status}>
                        <strong>OpenStreetMap GPS camera photo</strong>
                        <small>
                          Capture a fresh photo with your current location.
                          Allow camera and location when your browser asks.
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
                            {profile.gender === "female" && (
                              <option value="MATERNITY">
                                Maternity leave (180 days reference)
                              </option>
                            )}
                            {profile.gender === "male" && (
                              <option value="PATERNITY">
                                Paternity leave (15 days reference)
                              </option>
                            )}
                            <option value="OTHER">Other leave</option>
                          </select>
                        </label>
                        {["MATERNITY", "PATERNITY", "OTHER"].includes(
                          leaveType,
                        ) && (
                          <label className="sp-field">
                            {leaveType === "OTHER"
                              ? "Type and reason for other leave"
                              : "Reason for leave"}
                            <textarea
                              required
                              minLength={3}
                              maxLength={500}
                              rows={3}
                              value={leaveDetail}
                              onChange={(event) =>
                                setLeaveDetail(event.target.value)
                              }
                            />
                          </label>
                        )}
                        <label className="sp-field">
                          अवकाश दस्तावेज़ / Required leave document
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
                      मैं उपस्थिति की जानकारी कार्यालय के प्रशासक के साथ साझा
                      करने की सहमति देता/देती हूँ। कैमरा चुनने पर फोटो और उसका
                      स्थान भी साझा होगा।
                    </span>
                  </label>
                  <button className="sp-button sp-primary" disabled={busy}>
                    {busy
                      ? "सहेजा जा रहा है…"
                      : status === "leave"
                        ? "अवकाश आवेदन भेजें / Submit leave application"
                        : ["present", "deputation", "on_duty"].includes(status)
                          ? "GPS फोटो सहित आगमन सहेजें / Save arrival draft"
                          : "अनुपस्थिति सहेजें / Save absence"}
                  </button>
                  {busy && saveProgress && (
                    <p role="status" aria-live="polite" className="sp-note">
                      {saveProgress}
                    </p>
                  )}
                  <p className="sp-note">
                    Submit once and wait for the confirmation above. Your staff
                    login saves only your own attendance.
                  </p>
                  <p className="sp-note">
                    समय अपने आप दर्ज होगा।
                    {["present", "deputation", "on_duty"].includes(status)
                      ? " ड्राफ़्ट तुरंत प्रशासक को दिखाई देगा।"
                      : " अनुपस्थिति और अवकाश के लिए इन/आउट टाइम नहीं लगेगा।"}
                  </p>
                </fieldset>
              </form>
            </>
          )}
        </section>
        <section className="sp-card sp-leave-history">
          <h2>अवकाश शेष और इतिहास / Leave balance and history</h2>
          {leaveHistoryLoading ? (
            <p role="status">
              अवकाश जानकारी लोड हो रही है… / Loading leave information…
            </p>
          ) : leaveHistoryError ? (
            <p role="alert" className="sp-alert sp-error">
              {leaveHistoryError}
            </p>
          ) : (
            <>
              <p>
                <strong>{today.slice(0, 4)} balance:</strong>{" "}
                <LeaveBalanceDisplay
                  balance={staffBalance}
                  gender={profile.gender}
                />
              </p>
              <p className="sp-note">
                Only approved leave days count against CL/SL. Pending
                applications do not reduce your balance. Maternity, paternity
                and other leave are subject to admin approval.
              </p>
              <h3>पहले दर्ज अवकाश / Recorded leave days</h3>
              <p>
                {yearLeaves.length} recorded this year • {leaveUsage.length}{" "}
                shown across years
              </p>
            </>
          )}
          {leaveUsage.length > 0 && (
            <div className="sp-leave-request-list">
              {leaveUsage.map((entry) => (
                <p key={`${entry.date}-${entry.leave_type}`}>
                  {entry.date} • {entry.leave_type || "Leave"}
                </p>
              ))}
            </div>
          )}
          {!leaveHistoryLoading &&
            !leaveHistoryError &&
            leaveUsage.length === 0 && (
              <p className="sp-muted">
                कोई दर्ज अवकाश नहीं। / No recorded leave days yet.
              </p>
            )}
          <h3>अवकाश आवेदन / Leave applications</h3>
          <div className="sp-leave-request-list">
            {leaveHistory.map((application) => (
              <article key={application.id} className="sp-leave-request">
                <div>
                  <strong>
                    {application.leave_type} • {application.date}
                  </strong>
                  <p>
                    {application.status === "approved"
                      ? "स्वीकृत / Approved"
                      : application.status === "rejected"
                        ? "अस्वीकृत / Rejected"
                        : "लंबित / Pending"}
                  </p>
                  {application.leave_detail && (
                    <p>Reason/type: {application.leave_detail}</p>
                  )}
                  <p className="sp-muted">
                    Applied:{" "}
                    {new Date(application.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    IST
                  </p>
                  {application.decided_at && (
                    <p className="sp-muted">
                      Decision:{" "}
                      {new Date(application.decided_at).toLocaleString(
                        "en-IN",
                        { timeZone: "Asia/Kolkata" },
                      )}{" "}
                      IST
                    </p>
                  )}
                  {application.rejection_reason && (
                    <p>Reason: {application.rejection_reason}</p>
                  )}
                </div>
                {application.decision_document_path &&
                  (staffDecisionLinks[application.id] ? (
                    <a
                      className="sp-button sp-secondary"
                      href={staffDecisionLinks[application.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open signed document
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="sp-button sp-secondary"
                      onClick={() => void showStaffDecision(application.id)}
                    >
                      Get signed document
                    </button>
                  ))}
              </article>
            ))}
          </div>
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
  adminBlockId,
  role,
}: {
  initial?: Bootstrap | null;
  revisions: Revisions | null;
  fail: (err: unknown) => void;
  canManage: boolean;
  adminBlock: string;
  adminBlockId: string;
  role: "bpro" | "dpro";
}) {
  const [blocks, setBlocks] = useState<{ id: string; name_en: string }[]>([]);
  const [districtSummary, setDistrictSummary] = useState<
    {
      block: string;
      staff: number;
      present: number;
      absent: number;
      leave: number;
      deputation: number;
      not_marked: number;
    }[]
  >([]);
  useEffect(() => {
    void api("/api/blocks")
      .then((data) => setBlocks(data.blocks || []))
      .catch(fail);
  }, [fail]);
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
  const [date, setDate] = useState(initial?.date || dateToday()),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (role !== "dpro") return;
    void api(`/api/admin/district-summary?date=${encodeURIComponent(date)}`)
      .then((data) => setDistrictSummary(data.summary || []))
      .catch(fail);
  }, [role, date, revisions?.attendance, fail]);
  const [tab, setTab] = useState("attendance"),
    [loading, setLoading] = useState(!initial),
    [busy, setBusy] = useState(false);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveApplication[]>([]);
  const [leaveHistoryRows, setLeaveHistoryRows] = useState<LeaveApplication[]>(
    [],
  );
  const [historyDate, setHistoryDate] = useState(dateToday());
  const [historyBlockId, setHistoryBlockId] = useState("");
  const [decisionTarget, setDecisionTarget] = useState<{
    application: LeaveApplication;
    approve: boolean;
  } | null>(null);
  const [leaveStaffDetails, setLeaveStaffDetails] =
    useState<LeaveStaffDetails | null>(null);
  const [leaveStaffBusy, setLeaveStaffBusy] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [leaveDocumentLinks, setLeaveDocumentLinks] = useState<
    Record<string, string>
  >({});
  const [decisionDocumentLinks, setDecisionDocumentLinks] = useState<
    Record<string, string>
  >({});
  const [soundEnabled, setSoundEnabled] = useState(false);
  const alertAudio = useRef<AudioContext | null>(null);
  const seenLeaveIds = useRef<Set<string> | null>(null);
  const playLeaveSound = useCallback(() => {
    const context = alertAudio.current;
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    for (const [offset, frequency] of [
      [0, 660],
      [0.22, 880],
    ]) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start + offset);
      volume.gain.exponentialRampToValueAtTime(0.08, start + offset + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.18);
    }
  }, []);
  async function enableLeaveSound() {
    try {
      alertAudio.current ||= new window.AudioContext();
      await alertAudio.current.resume();
      setSoundEnabled(true);
      playLeaveSound();
    } catch {
      setLeaveError("Browser blocked alert sound. Tap Enable sound again.");
    }
  }
  const refreshPendingLeaves = useCallback(async () => {
    const data = await api("/api/leave-applications");
    const applications: LeaveApplication[] = data.applications || [];
    const nextIds = new Set(applications.map((application) => application.id));
    if (
      seenLeaveIds.current &&
      applications.some(
        (application) => !seenLeaveIds.current?.has(application.id),
      ) &&
      soundEnabled
    )
      playLeaveSound();
    seenLeaveIds.current = nextIds;
    setPendingLeaves(applications);
    setLeaveError("");
  }, [soundEnabled, playLeaveSound]);
  useEffect(() => {
    void refreshPendingLeaves().catch((error) =>
      setLeaveError(
        error instanceof Error
          ? error.message
          : "Leave applications could not load.",
      ),
    );
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshPendingLeaves().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [refreshPendingLeaves]);
  const refreshLeaveHistory = useCallback(async () => {
    const data = await api(
      `/api/leave-applications?view=history&date=${historyDate}${role === "dpro" && historyBlockId ? `&block_id=${historyBlockId}` : ""}`,
    );
    setLeaveHistoryRows(data.history || []);
  }, [historyDate, historyBlockId, role]);
  useEffect(() => {
    if (tab === "leave_history")
      void refreshLeaveHistory().catch((error) =>
        setLeaveError(
          error instanceof Error ? error.message : "History could not load.",
        ),
      );
  }, [tab, refreshLeaveHistory]);
  async function decideLeave(form: FormData) {
    if (!decisionTarget) return;
    setDecisionBusy(decisionTarget.application.id);
    setLeaveError("");
    try {
      await sendLeaveDecision(form);
      setPendingLeaves((current) =>
        current.filter((item) => item.id !== decisionTarget.application.id),
      );
      setDecisionTarget(null);
      await load(false, true);
      await refreshPendingLeaves();
      await refreshLeaveHistory();
    } catch (error) {
      setLeaveError(
        error instanceof Error ? error.message : "Leave decision failed.",
      );
      await refreshPendingLeaves().catch(() => {});
    } finally {
      setDecisionBusy(null);
    }
  }
  async function showLeaveDocument(application: LeaveApplication) {
    try {
      const result = await api(
        `/api/files?id=${encodeURIComponent(application.id)}&kind=application_leave_path`,
      );
      setLeaveDocumentLinks((current) => ({
        ...current,
        [application.id]: result.url,
      }));
    } catch (error) {
      setLeaveError(
        error instanceof Error
          ? error.message
          : "Leave document could not open.",
      );
    }
  }
  async function showDecisionDocument(application: LeaveApplication) {
    try {
      const result = await api(
        `/api/files?id=${encodeURIComponent(application.id)}&kind=decision_document_path`,
      );
      setDecisionDocumentLinks((current) => ({
        ...current,
        [application.id]: result.url,
      }));
    } catch (error) {
      setLeaveError(
        error instanceof Error
          ? error.message
          : "Signed document could not open.",
      );
    }
  }
  async function showLeaveStaffDetails(application: LeaveApplication) {
    setLeaveStaffBusy(true);
    setLeaveError("");
    try {
      const data = await api(
        `/api/leave-applications?view=staff&id=${encodeURIComponent(application.id)}`,
      );
      setLeaveStaffDetails(data);
    } catch (error) {
      setLeaveError(
        error instanceof Error
          ? error.message
          : "Staff details could not load.",
      );
    } finally {
      setLeaveStaffBusy(false);
    }
  }
  const [filters, setFilters] = useState<
    DirectoryFilters & { status: string; phase: string }
  >({
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
  const [refreshDirectory, setRefreshDirectory] = useState(0);
  useEffect(() => {
    let active = true;
    void api("/api/admin?view=directory")
      .then((data) => {
        if (!active) return;
        setStaff(data.staff || []);
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [refreshDirectory, revisions?.directory, revisions?.profile, fail]);
  useEffect(() => {
    let active = true;
    void api("/api/admin?view=balances")
      .then((data) => {
        if (active) setLeaveBalances(data.leaveBalances || null);
      })
      .catch(fail);
    return () => {
      active = false;
    };
  }, [refreshDirectory, revisions?.attendance, revisions?.profile, fail]);
  const skipInitial = useRef(!!initial);
  const load = useCallback(
    async (forceDirectory = false, background = false) => {
      const id = ++requestId.current;
      if (forceDirectory) setRefreshDirectory((value) => value + 1);
      if (!background) setBusy(true);
      try {
        const filterBlockId =
          role === "dpro" && filters.block
            ? blocks.find((block) => block.name_en === filters.block)?.id || ""
            : "";
        const data = await api(
          `/api/admin?date=${encodeURIComponent(date)}${filterBlockId ? `&block_id=${encodeURIComponent(filterBlockId)}` : ""}&directory=0&balances=0`,
        );
        if (alive.current && id === requestId.current) {
          if (retryAdmin.current) clearTimeout(retryAdmin.current);
          setRecords(data.records || []);
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
    [date, fail, role, filters.block, blocks],
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
    const hadRevision = prior.directory !== undefined;
    const directoryChanged =
      hadRevision &&
      (prior.directory !== revisions?.directory ||
        prior.profile !== revisions?.profile);
    const attendanceChanged =
      hadRevision &&
      (prior.attendance !== revisions?.attendance ||
        prior.profile !== revisions?.profile);
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
        department: row.department || a?.department,
        position: row.position || a?.position,
      };
    });
  }, [records, staff]);
  const recordsByStaff = useMemo(() => {
    const index = new Map<string, typeof normalized>();
    for (const row of normalized)
      index.set(row.staff_id, [...(index.get(row.staff_id) || []), row]);
    return index;
  }, [normalized]);
  const searchMatches = (person?: Profile, snapshotName?: string) =>
    !search.trim() ||
    `${person?.name || snapshotName || ""} ${person?.phone || ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const visibleRecords = normalized.filter(
    (row) =>
      searchMatches(row.profiles, row.staff_name) &&
      Object.entries(filters).every(
        ([key, value]) =>
          !value ||
          (key === "phase" ? phase(row) : row[key as keyof RecordRow]) ===
            value,
      ),
  );
  const directoryPeople = staff;
  const visibleStaff = useMemo(
    () => filterDirectoryStaff(directoryPeople, search, filters),
    [directoryPeople, search, filters],
  );
  const [directoryLimit, setDirectoryLimit] = useState(100);
  const directorySentinel = useRef<HTMLDivElement>(null);
  const balanceByStaff = useMemo(
    () =>
      new Map(
        leaveBalances?.balances.map((entry) => [entry.staff_id, entry]) || [],
      ),
    [leaveBalances],
  );
  useEffect(() => {
    setDirectoryLimit(100);
  }, [search, filters]);
  useEffect(() => {
    const node = directorySentinel.current;
    if (tab !== "staff" || !node || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setDirectoryLimit((current) =>
            Math.min(current + 100, visibleStaff.length),
          );
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, directoryLimit, visibleStaff.length]);
  const [page, setPage] = useState(1);
  const totalRows = visibleRecords.length;
  const pages = Math.max(1, Math.ceil(totalRows / 25));
  const activePage = Math.min(page, pages);
  useEffect(() => {
    setPage(1);
  }, [search, filters, tab, date]);
  const start = (activePage - 1) * 25;
  const directoryOptions = useMemo(
    () => directoryChoices(directoryPeople, filters),
    [directoryPeople, filters],
  );
  const attendanceOptions = normalized.filter(
    (record) => !filters.block || record.block === filters.block,
  );
  const panchayatOptions =
    tab === "staff"
      ? directoryOptions.panchayats
      : unique(attendanceOptions.map((record) => record.panchayat));
  const positionOptions =
    tab === "staff"
      ? directoryOptions.positions
      : unique(
          attendanceOptions
            .filter(
              (record) =>
                !filters.panchayat || record.panchayat === filters.panchayat,
            )
            .map((record) => record.position),
        );
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
  function filter(key: string, value: string) {
    setFilters((previous) =>
      key === "block"
        ? { ...previous, block: value, panchayat: "", position: "" }
        : key === "panchayat"
          ? { ...previous, panchayat: value, position: "" }
          : { ...previous, [key]: value },
    );
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
        {pendingLeaves.length > 0 && (
          <div className="sp-leave-notification" role="status">
            <strong>
              🔔 {pendingLeaves.length} अवकाश आवेदन लंबित / leave application
              {pendingLeaves.length === 1 ? "" : "s"} pending
            </strong>
            <div className="sp-actions">
              <button
                type="button"
                className="sp-button sp-secondary"
                onClick={() => setTab("leave")}
              >
                View applications
              </button>
              {!soundEnabled && (
                <button
                  type="button"
                  className="sp-button sp-secondary"
                  onClick={() => void enableLeaveSound()}
                >
                  Enable alert sound
                </button>
              )}
            </div>
          </div>
        )}
        <ReportDownload
          selectedDate={date}
          staff={staff}
          role={role}
          blocks={blocks}
        />
        {role === "dpro" && (
          <section className="sp-card sp-summary">
            <h2>जिला सारांश / District summary ({date})</h2>
            <div className="sp-table-scroll">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Block</th>
                    <th>Staff</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Leave</th>
                    <th>Deputation</th>
                    <th>Not marked</th>
                  </tr>
                </thead>
                <tbody>
                  {districtSummary.map((row) => (
                    <tr key={row.block}>
                      <td>{row.block}</td>
                      <td>{row.staff}</td>
                      <td>{row.present}</td>
                      <td>{row.absent}</td>
                      <td>{row.leave}</td>
                      <td>{row.deputation}</td>
                      <td>{row.not_marked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
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
              aria-selected={tab === "leave"}
              onClick={() => {
                setTab("leave");
                void refreshPendingLeaves().catch(() => {});
              }}
            >
              अवकाश आवेदन / Pending leave ({pendingLeaves.length})
            </button>
            <button
              role="tab"
              aria-selected={tab === "leave_history"}
              onClick={() => setTab("leave_history")}
            >
              अवकाश इतिहास / Leave history
            </button>
            <button
              role="tab"
              aria-selected={tab === "office"}
              onClick={() => setTab("office")}
            >
              अवकाश और सूचनाएँ / Holidays & Notices
            </button>
          </div>
          {tab === "leave_history" ? (
            <div className="sp-leave-approvals">
              <div className="sp-actions">
                <label className="sp-field">
                  Leave date / अवकाश तिथि
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(event) => setHistoryDate(event.target.value)}
                  />
                </label>
                {role === "dpro" && (
                  <label className="sp-field">
                    Block / प्रखंड
                    <select
                      value={historyBlockId}
                      onChange={(event) =>
                        setHistoryBlockId(event.target.value)
                      }
                    >
                      <option value="">All blocks</option>
                      {blocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.name_en}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="sp-button sp-secondary"
                  type="button"
                  onClick={() =>
                    void refreshLeaveHistory().catch((error) =>
                      setLeaveError(
                        error instanceof Error
                          ? error.message
                          : "History could not load.",
                      ),
                    )
                  }
                >
                  Refresh
                </button>
              </div>
              {leaveError && (
                <p role="alert" className="sp-alert sp-error">
                  {leaveError}
                </p>
              )}
              {!leaveHistoryRows.length && (
                <p className="sp-muted">No leave decisions for this date.</p>
              )}
              <div className="sp-leave-request-list">
                {leaveHistoryRows.map((application) => (
                  <article key={application.id} className="sp-leave-request">
                    <div>
                      <strong>{application.staff_name}</strong>
                      <p>
                        {application.blocks?.name_en || adminBlock} •{" "}
                        {application.panchayat} • {application.position}
                      </p>
                      <p>
                        {application.leave_type} • Leave: {application.date} •{" "}
                        {application.status === "approved"
                          ? "Approved"
                          : "Rejected"}
                      </p>
                      {application.leave_detail && (
                        <p>Reason/type: {application.leave_detail}</p>
                      )}
                      {application.decided_at && (
                        <p>
                          Decision:{" "}
                          {new Date(application.decided_at).toLocaleString(
                            "en-IN",
                            { timeZone: "Asia/Kolkata" },
                          )}{" "}
                          IST{" "}
                          {application.decider?.name
                            ? `• ${application.decider.name} (${application.decider.role.toUpperCase()})`
                            : ""}
                        </p>
                      )}
                      {application.rejection_reason && (
                        <p>Reason: {application.rejection_reason}</p>
                      )}
                    </div>
                    {application.decision_document_path &&
                      (decisionDocumentLinks[application.id] ? (
                        <a
                          className="sp-button sp-secondary"
                          href={decisionDocumentLinks[application.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open signed document
                        </a>
                      ) : (
                        <button
                          className="sp-button sp-secondary"
                          type="button"
                          onClick={() => void showDecisionDocument(application)}
                        >
                          Get signed document
                        </button>
                      ))}
                  </article>
                ))}
              </div>
            </div>
          ) : tab === "leave" ? (
            <div className="sp-leave-approvals">
              <div className="sp-actions">
                <p role="status">
                  {pendingLeaves.length} pending leave applications
                </p>
                <button
                  type="button"
                  className="sp-button sp-secondary"
                  onClick={() => void enableLeaveSound()}
                >
                  {soundEnabled ? "🔔 Alert sound on" : "🔔 Enable alert sound"}
                </button>
                <button
                  type="button"
                  className="sp-button sp-secondary"
                  onClick={() =>
                    void refreshPendingLeaves().catch((error) =>
                      setLeaveError(
                        error instanceof Error
                          ? error.message
                          : "Refresh failed.",
                      ),
                    )
                  }
                >
                  Refresh
                </button>
              </div>
              {leaveError && (
                <p role="alert" className="sp-alert sp-error">
                  {leaveError}
                </p>
              )}
              {!pendingLeaves.length && !leaveError && (
                <p className="sp-muted">
                  No leave applications are waiting for approval.
                </p>
              )}
              <div className="sp-leave-request-list">
                {pendingLeaves.map((application) => (
                  <article key={application.id} className="sp-leave-request">
                    <div>
                      <strong translate="no">{application.staff_name}</strong>
                      <p className="sp-muted">
                        {application.blocks?.name_en || adminBlock} •{" "}
                        {application.panchayat} • {application.position}
                      </p>
                      <p>
                        {application.leave_type} • {application.date} • Applied{" "}
                        {new Date(application.created_at).toLocaleString(
                          "en-IN",
                        )}
                      </p>
                    </div>
                    <div className="sp-actions">
                      <button
                        type="button"
                        className="sp-button sp-secondary"
                        disabled={leaveStaffBusy}
                        onClick={() => void showLeaveStaffDetails(application)}
                      >
                        {leaveStaffBusy
                          ? "Loading…"
                          : "View full staff details"}
                      </button>
                      {leaveDocumentLinks[application.id] ? (
                        <a
                          className="sp-button sp-secondary"
                          href={leaveDocumentLinks[application.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open document
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="sp-button sp-secondary"
                          onClick={() => void showLeaveDocument(application)}
                        >
                          View document
                        </button>
                      )}
                      <button
                        type="button"
                        className="sp-button sp-primary"
                        title="Approve"
                        aria-label={`Approve leave for ${application.staff_name}`}
                        disabled={decisionBusy !== null}
                        onClick={() =>
                          setDecisionTarget({ application, approve: true })
                        }
                      >
                        ✓ Approve
                      </button>
                      <button
                        type="button"
                        className="sp-button sp-secondary"
                        title="Reject"
                        aria-label={`Reject leave for ${application.staff_name}`}
                        disabled={decisionBusy !== null}
                        onClick={() =>
                          setDecisionTarget({ application, approve: false })
                        }
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : tab === "office" ? (
            <OfficeSettings
              feed={office.feed}
              error={office.error}
              reload={office.reload}
              canManage={canManage}
              role={role}
              blocks={blocks}
            />
          ) : (
            <>
              {tab === "staff" && (
                <div className="sp-actions">
                  {(["xlsx", "pdf"] as const).map((format) => {
                    const blockId =
                      role === "dpro" && filters.block
                        ? blocks.find(
                            (block) => block.name_en === filters.block,
                          )?.id
                        : undefined;
                    return (
                      <a
                        key={format}
                        className="sp-button sp-secondary"
                        href={`/api/staff/export?format=${format}${blockId ? `&block_id=${blockId}` : ""}`}
                      >
                        Download directory {format.toUpperCase()}
                      </a>
                    );
                  })}
                </div>
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
                {role === "dpro" && (
                  <SelectField
                    label="प्रखंड / Block"
                    value={filters.block}
                    onChange={(v) => filter("block", v)}
                    options={blocks.map((block) => block.name_en)}
                  />
                )}
                <SelectField
                  label="पंचायत / Panchayat"
                  value={filters.panchayat}
                  onChange={(v) => filter("panchayat", v)}
                  options={panchayatOptions}
                />
                <SelectField
                  label="पद / Position"
                  value={filters.position}
                  onChange={(v) => filter("position", v)}
                  options={positionOptions}
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
                    : `${visibleStaff.length} कर्मी`}
                </p>
                <button
                  className="sp-text-button"
                  onClick={() => {
                    setSearch("");
                    setFilters({
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
                                  {row.profiles?.name ||
                                    row.staff_name ||
                                    "कर्मी"}
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
                                <small>{row.block || ""}</small>
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
                        <th scope="col">पंचायत और पद / Assignment</th>
                        <th scope="col">उपस्थिति / Attendance ({date})</th>
                        <th scope="col">अवकाश शेष / Leave left</th>
                        <th scope="col">विवरण / Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStaff.slice(0, directoryLimit).map((person) => (
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
                              पंचायत और पद / Assignment
                            </span>
                            <div className="sp-cell-value">
                              {matchingAssignments(person, filters).map(
                                (a, i) => (
                                  <small key={i}>
                                    {a.panchayat} • {a.position}
                                  </small>
                                ),
                              )}
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
                              {person.roster_only ? (
                                "Login pending / लॉगिन बाकी"
                              ) : (
                                <LeaveBalanceDisplay
                                  balance={balanceByStaff.get(person.id)}
                                  gender={person.gender}
                                />
                              )}
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
                                        onClick={() => editStaff(person, true)}
                                      >
                                        हटाएँ / Remove
                                      </button>
                                    </>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {directoryLimit < visibleStaff.length && (
                    <div ref={directorySentinel} className="sp-list-caption">
                      <span>
                        {directoryLimit} / {visibleStaff.length} staff shown
                      </span>
                      <button
                        type="button"
                        className="sp-text-button"
                        onClick={() =>
                          setDirectoryLimit((current) =>
                            Math.min(current + 100, visibleStaff.length),
                          )
                        }
                      >
                        Show more
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="sp-empty">
                  कोई कर्मी नहीं मिला। खोज या फ़िल्टर बदलें।
                </p>
              )}
              {tab !== "staff" && pages > 1 && (
                <nav className="sp-pagination" aria-label="Attendance pages">
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
                <SavedDepartureEvidence
                  key={`${detail.id}-departure`}
                  row={detail}
                />
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
                    {a.panchayat} • {a.position}
                  </p>
                ))}
              </>
            ))}
        </dialog>
        {editor && (
          <StaffEditor
            block={adminBlock}
            blockId={adminBlockId}
            role={role}
            blocks={blocks}
            person={editor.person}
            remove={editor.remove}
            staff={staff}
            onClose={() => setEditor(null)}
            onFound={(phone) => {
              setEditor(null);
              setTab("staff");
              setSearch(phone);
              setFilters({
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
        {leaveStaffDetails && (
          <div
            className="sp-decision-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setLeaveStaffDetails(null);
            }}
          >
            <section
              className="sp-decision-dialog sp-staff-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="leave-staff-details-title"
            >
              <div className="sp-dialog-header">
                <h2 id="leave-staff-details-title">
                  Staff details / कर्मी विवरण
                </h2>
                <button
                  type="button"
                  className="sp-button sp-secondary"
                  onClick={() => setLeaveStaffDetails(null)}
                >
                  Close
                </button>
              </div>
              <h3 translate="no">{leaveStaffDetails.staff.name}</h3>
              <dl className="sp-details">
                <div>
                  <dt>Mobile</dt>
                  <dd>{leaveStaffDetails.staff.phone || "—"}</dd>
                </div>
                {!!leaveStaffDetails.staff.secondary_phones?.length && (
                  <div>
                    <dt>Other numbers</dt>
                    <dd>
                      {leaveStaffDetails.staff.secondary_phones.join(", ")}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Email</dt>
                  <dd>{leaveStaffDetails.staff.email || "—"}</dd>
                </div>
                <div>
                  <dt>Block</dt>
                  <dd>{leaveStaffDetails.staff.block}</dd>
                </div>
                <div>
                  <dt>Gender</dt>
                  <dd>{leaveStaffDetails.staff.gender || "Not set"}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>
                    {leaveStaffDetails.staff.active ? "Active" : "Inactive"}
                  </dd>
                </div>
                <div>
                  <dt>Today ({leaveStaffDetails.today})</dt>
                  <dd>
                    {leaveStaffDetails.attendance.find(
                      (entry) => entry.date === leaveStaffDetails.today,
                    )?.status || "Not marked / leave request pending"}
                  </dd>
                </div>
                <div>
                  <dt>Leave left ({leaveStaffDetails.balanceYear || "—"})</dt>
                  <dd>
                    <LeaveBalanceDisplay
                      balance={leaveStaffDetails.leaveBalance || undefined}
                      gender={leaveStaffDetails.staff.gender}
                    />
                  </dd>
                </div>
              </dl>
              <h3>Assignments / आवंटन</h3>
              {leaveStaffDetails.staff.assignments?.length ? (
                leaveStaffDetails.staff.assignments.map((assignment, index) => (
                  <p key={index}>
                    {assignment.panchayat} • {assignment.position} •{" "}
                    {assignment.department}
                  </p>
                ))
              ) : (
                <p>None recorded</p>
              )}
              <h3>Previous leave applications</h3>
              {leaveStaffDetails.leaveHistory.length ? (
                <div className="sp-staff-review-list">
                  {leaveStaffDetails.leaveHistory.map((application) => (
                    <p key={application.id}>
                      {application.date} • {application.leave_type} •{" "}
                      {application.status}
                      {application.leave_detail
                        ? ` • ${application.leave_detail}`
                        : ""}
                      {application.decided_at
                        ? ` • Decided ${new Date(application.decided_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
                        : ""}
                      {application.rejection_reason
                        ? ` • Reason: ${application.rejection_reason}`
                        : ""}
                    </p>
                  ))}
                </div>
              ) : (
                <p>None recorded</p>
              )}
              <h3>Recent attendance</h3>
              {leaveStaffDetails.attendance.length ? (
                <div className="sp-staff-review-list">
                  {leaveStaffDetails.attendance.map((entry) => (
                    <p key={`${entry.date}-${entry.panchayat}`}>
                      {entry.date} • {entry.status}
                      {entry.leave_type ? ` (${entry.leave_type})` : ""} •{" "}
                      {entry.panchayat} • {entry.position} • In{" "}
                      {entry.time_in ? time(entry.time_in) : "—"} • Out{" "}
                      {entry.time_out ? time(entry.time_out) : "—"}
                    </p>
                  ))}
                </div>
              ) : (
                <p>No recorded attendance</p>
              )}
            </section>
          </div>
        )}
        {decisionTarget && (
          <LeaveDecisionDialog
            request={decisionTarget.application}
            approve={decisionTarget.approve}
            busy={decisionBusy !== null}
            onClose={() => setDecisionTarget(null)}
            onSubmit={decideLeave}
          />
        )}
      </>
    </Localized>
  );
}
