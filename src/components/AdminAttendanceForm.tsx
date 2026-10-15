"use client";
import { useState } from "react";
import { localizeContent, type Language } from "../lib/language";
import type { Profile } from "../lib/types";
export default function AdminAttendanceForm({
  staff,
  date,
  language,
  busy,
  onSave,
}: {
  staff: Profile[];
  date: string;
  language: Language;
  busy: boolean;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [selected, setSelected] = useState(""),
    [status, setStatus] = useState("present");
  const p = staff.find((p) => p.id === selected);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const day = String(f.get("date"));
    const stamp = (key: string) =>
      f.get(key)
        ? new Date(`${day}T${f.get(key)}:00+05:30`).toISOString()
        : null;
    onSave({
      action: "input",
      staff_id: selected,
      date: day,
      panchayat: f.get("panchayat"),
      status,
      time_in: status === "present" ? stamp("time_in") : null,
      time_out: status === "present" ? stamp("time_out") : null,
    });
  }
  return localizeContent(
    <form onSubmit={submit}>
      <p className="manual-note">
        एडमिन द्वारा दर्ज उपस्थिति अलग चिह्नित होगी। उसी दिन का रिकॉर्ड मौजूद हो
        तो उसका डेटा अपडेट होगा।
      </p>
      <label className="field-label">
        कर्मी चुनें
        <select
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">कर्मी चुनें</option>
          {staff
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.phone}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label className="field-label">
          तिथि
          <input
            type="date"
            name="date"
            defaultValue={date}
            max={new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date())}
            required
          />
        </label>
        <label className="field-label">
          स्थिति
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="present">उपस्थित</option>
            <option value="leave">अवकाश</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        दर्ज करने का कार्यस्थल
        <select name="panchayat" key={selected} required disabled={!p}>
          {p?.assignments.map((a) => (
            <option key={a.panchayat} value={a.panchayat}>
              {a.panchayat}
            </option>
          ))}
        </select>
      </label>
      {p && (
        <div className="shared-record-note">
          <strong>इन सभी कार्यस्थलों में यही डेटा दिखेगा</strong>
          <p>
            {p.assignments.map((a, i) => (
              <span key={a.panchayat}>
                {i > 0 ? " · " : ""}
                {a.panchayat}
              </span>
            ))}
          </p>
        </div>
      )}
      {status === "present" && (
        <div className="form-grid">
          <label className="field-label">
            पंच इन (IST)
            <input type="time" name="time_in" defaultValue="09:00" required />
          </label>
          <label className="field-label">
            पंच आउट (IST)
            <input type="time" name="time_out" />
          </label>
        </div>
      )}

      <button className="button primary" disabled={busy}>
        {busy ? "सुरक्षित कर रहे हैं…" : "उपस्थिति सुरक्षित करें"}
      </button>
    </form>,
    language,
  );
}
