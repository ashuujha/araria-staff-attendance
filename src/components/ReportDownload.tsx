"use client";

import { useEffect, useState } from "react";
import type { Profile } from "../lib/types";

type Filters = {
  search: string;
  department: string;
  position: string;
  block: string;
  panchayat: string;
};
const blank: Filters = {
  search: "",
  department: "",
  position: "",
  block: "",
  panchayat: "",
};
const unique = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "hi"));

export default function ReportDownload({
  selectedDate,
  staff,
}: {
  selectedDate: string;
  staff: Profile[];
}) {
  const [period, setPeriod] = useState<"day" | "month" | "range">("day");
  const [reportKind, setReportKind] = useState<"attendance" | "leave">(
    "attendance",
  );
  const [leaveYear, setLeaveYear] = useState(selectedDate.slice(0, 4));
  const [onlyWithLeave, setOnlyWithLeave] = useState(true);
  const [start, setStart] = useState(selectedDate);
  const [end, setEnd] = useState(selectedDate);
  const [scope, setScope] = useState<"all" | "filtered" | null>(null);
  const [filters, setFilters] = useState<Filters>(blank);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setStart(selectedDate);
    setEnd(selectedDate);
    setLeaveYear(selectedDate.slice(0, 4));
  }, [selectedDate]);

  const assignments = staff.flatMap((person) =>
    (person.assignments || []).map((place) => ({
      ...place,
      block: person.block,
    })),
  );
  const relevant = assignments.filter(
    (place) =>
      (!filters.department || place.department === filters.department) &&
      (!filters.position || place.position === filters.position) &&
      (!filters.block || place.block === filters.block),
  );
  const departments = unique(assignments.map((place) => place.department));
  const positions = unique(
    assignments
      .filter(
        (place) =>
          !filters.department || place.department === filters.department,
      )
      .map((place) => place.position),
  );
  const blocks = unique(staff.map((person) => person.block));
  const panchayats = unique(relevant.map((place) => place.panchayat));
  function updateFilter(key: keyof Filters, value: string) {
    setFilters((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "department" ? { position: "", panchayat: "" } : {}),
      ...(key === "position" || key === "block" ? { panchayat: "" } : {}),
    }));
    setError("");
  }
  async function download(format: "xlsx" | "pdf") {
    if (busy) return;
    setError("");
    try {
      if (!scope) throw Error("Choose all staff or add report filters first.");
      if (
        scope === "filtered" &&
        !Object.values(filters).some((value) => value.trim())
      )
        throw Error("Enter at least one report filter, or choose all staff.");
      if (reportKind === "leave" && !/^(20\d\d|2100)$/.test(leaveYear))
        throw Error("Choose a valid leave report year.");
      if (reportKind === "attendance" && period !== "day" && !start)
        throw Error("Choose a start date.");
      if (
        reportKind === "attendance" &&
        period === "range" &&
        (!end || end < start)
      )
        throw Error("Choose an end date on or after the start date.");
      setBusy(format);
      const params = new URLSearchParams({
        kind: reportKind,
        format,
        period,
        start: period === "day" ? selectedDate : start,
        end,
      });
      if (reportKind === "leave") {
        params.set("year", leaveYear);
        if (onlyWithLeave) params.set("leave_only", "1");
      }
      if (scope === "filtered")
        for (const [key, value] of Object.entries(filters))
          if (value.trim()) params.set(key, value.trim());
      const response = await fetch(`/api/admin/reports?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        const result = await response.json();
        throw Error(result.error || "Report could not be downloaded.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const file =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || `araria-attendance.${format}`;
      const link = document.createElement("a");
      link.href = href;
      link.download = file;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Report could not be downloaded.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <details
      className="sp-card sp-report-download"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setScope(null);
          setError("");
        }
      }}
    >
      <summary>
        Download attendance or leave report / उपस्थिति या अवकाश रिपोर्ट डाउनलोड
        करें
      </summary>
      <div className="sp-filters sp-report-filters">
        <label className="sp-field">
          Report type / रिपोर्ट प्रकार
          <select
            value={reportKind}
            onChange={(event) => {
              setReportKind(event.target.value as typeof reportKind);
              setError("");
            }}
          >
            <option value="attendance">Attendance / उपस्थिति</option>
            <option value="leave">Leave balances / अवकाश शेष</option>
          </select>
        </label>
        {reportKind === "leave" && (
          <label className="sp-field">
            Leave year / अवकाश वर्ष
            <input
              type="number"
              min={2000}
              max={2100}
              value={leaveYear}
              onChange={(event) => setLeaveYear(event.target.value)}
            />
          </label>
        )}
      </div>
      <fieldset className="sp-report-choice">
        <legend>
          Do you want to filter this report? / रिपोर्ट में फ़िल्टर लगाएँ?
        </legend>
        <label>
          <input
            type="radio"
            name="report-scope"
            checked={scope === "all"}
            onChange={() => {
              setScope("all");
              setError("");
            }}
          />
          No, include all staff / सभी कर्मी
        </label>
        <label>
          <input
            type="radio"
            name="report-scope"
            checked={scope === "filtered"}
            onChange={() => {
              setScope("filtered");
              setError("");
            }}
          />
          Yes, add filters / फ़िल्टर लगाएँ
        </label>
      </fieldset>
      {scope === "filtered" && (
        <div className="sp-filters sp-report-filters">
          <label className="sp-field sp-search">
            Staff name or mobile / नाम या मोबाइल
            <input
              type="search"
              maxLength={150}
              value={filters.search}
              placeholder="Enter a name or phone number"
              onChange={(event) => updateFilter("search", event.target.value)}
            />
          </label>
          <label className="sp-field">
            Department / विभाग
            <select
              value={filters.department}
              onChange={(event) =>
                updateFilter("department", event.target.value)
              }
            >
              <option value="">All departments</option>
              {departments.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-field">
            Designation / पद
            <select
              value={filters.position}
              onChange={(event) => updateFilter("position", event.target.value)}
            >
              <option value="">All designations</option>
              {positions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-field">
            Block / प्रखंड
            <select
              value={filters.block}
              onChange={(event) => updateFilter("block", event.target.value)}
            >
              <option value="">All blocks</option>
              {blocks.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-field">
            Panchayat / पंचायत
            <select
              value={filters.panchayat}
              onChange={(event) =>
                updateFilter("panchayat", event.target.value)
              }
            >
              <option value="">All panchayats</option>
              {panchayats.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <p className="sp-muted sp-report-filter-note">
            Filters apply only to this download. Combine fields to narrow the
            staff list.
          </p>
        </div>
      )}
      {scope && (
        <>
          <p className="sp-muted">
            {scope === "all"
              ? "The report includes all staff available to your administrator account."
              : "The report includes every matching staff member, across all dashboard pages."}
          </p>
          {reportKind === "leave" && (
            <label className="sp-report-leave-only">
              <input
                type="checkbox"
                checked={onlyWithLeave}
                onChange={(event) => setOnlyWithLeave(event.target.checked)}
              />
              Only staff with recorded leave this year / केवल अवकाश लेने वाले
              कर्मी
            </label>
          )}
          {reportKind === "attendance" && (
            <div className="sp-filters">
              <label className="sp-field">
                Period / अवधि
                <select
                  value={period}
                  onChange={(event) =>
                    setPeriod(event.target.value as typeof period)
                  }
                >
                  <option value="day">Selected day</option>
                  <option value="month">Month</option>
                  <option value="range">Date range</option>
                </select>
              </label>
              {period !== "day" && (
                <label className="sp-field">
                  Start date / शुरू
                  <input
                    type="date"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    required
                  />
                </label>
              )}
              {period === "range" && (
                <label className="sp-field">
                  End date / अंत
                  <input
                    type="date"
                    value={end}
                    min={start}
                    onChange={(event) => setEnd(event.target.value)}
                    required
                  />
                </label>
              )}
            </div>
          )}
          <div className="sp-actions">
            <button
              type="button"
              className="sp-button sp-primary"
              disabled={!!busy}
              onClick={() => void download("xlsx")}
            >
              {busy === "xlsx"
                ? "Preparing…"
                : `Download ${reportKind === "leave" ? "leave " : ""}Excel (.xlsx)`}
            </button>
            <button
              type="button"
              className="sp-button sp-secondary"
              disabled={!!busy}
              onClick={() => void download("pdf")}
            >
              {busy === "pdf"
                ? "Preparing…"
                : `Download ${reportKind === "leave" ? "leave " : ""}PDF`}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="sp-alert sp-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
