"use client";

import { useEffect, useState } from "react";

export default function ReportDownload({
  selectedDate,
  search,
  filters,
}: {
  selectedDate: string;
  search: string;
  filters: Record<string, string>;
}) {
  const [period, setPeriod] = useState<"day" | "month" | "range">("day");
  const [start, setStart] = useState(selectedDate);
  const [end, setEnd] = useState(selectedDate);
  useEffect(() => {
    setStart(selectedDate);
    setEnd(selectedDate);
  }, [selectedDate]);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [error, setError] = useState("");
  async function download(format: "xlsx" | "pdf") {
    if (busy) return;
    setBusy(format);
    setError("");
    try {
      if (period !== "day" && !start) throw Error("Choose a start date.");
      if (period === "range" && (!end || end < start))
        throw Error("Choose an end date on or after the start date.");
      const params = new URLSearchParams({
        format,
        period,
        start: period === "day" ? selectedDate : start,
        end,
      });
      if (search.trim()) params.set("search", search.trim());
      for (const [key, value] of Object.entries(filters))
        if (value) params.set(key, value);
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
    <details className="sp-card sp-report-download">
      <summary>
        Download attendance report / उपस्थिति रिपोर्ट डाउनलोड करें
      </summary>
      <p className="sp-muted">
        The report includes all staff matching the current search and filters,
        across every dashboard page.
      </p>
      <div className="sp-filters">
        <label className="sp-field">
          Period / अवधि
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as typeof period)}
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
      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-primary"
          disabled={!!busy}
          onClick={() => void download("xlsx")}
        >
          {busy === "xlsx" ? "Preparing…" : "Download Excel (.xlsx)"}
        </button>
        <button
          type="button"
          className="sp-button sp-secondary"
          disabled={!!busy}
          onClick={() => void download("pdf")}
        >
          {busy === "pdf" ? "Preparing…" : "Download PDF"}
        </button>
      </div>
      {error && (
        <p className="sp-alert sp-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
