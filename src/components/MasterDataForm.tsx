"use client";
import { useState } from "react";
import { panchayats, positions } from "../lib/demo";
import { localizeContent, type Language } from "../lib/language";
import type { Profile, Assignment } from "../lib/types";
export type MasterInput = {
  name: string;
  phone: string;
  email: string;
  active: boolean;
  reset_device: boolean;
  assignments: Assignment[];
  reason: string;
};
export default function MasterDataForm({
  staff,
  language,
  busy,
  onSave,
}: {
  staff?: Profile;
  language: Language;
  busy: boolean;
  onSave: (data: MasterInput) => void;
}) {
  const [places, setPlaces] = useState(
    staff?.assignments.map((a) => a.panchayat) || [],
  );
  const [error, setError] = useState("");
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!places.length) {
      setError("कम से कम एक कार्यस्थल चुनें।");
      return;
    }
    const f = new FormData(e.currentTarget);
    onSave({
      name: String(f.get("name")),
      phone: String(f.get("phone")),
      email: String(f.get("email") || ""),
      active: staff ? f.get("active") === "on" : true,
      reset_device: f.get("reset_device") === "on",
      assignments: places.map((p) => ({
        panchayat: p,
        position: String(f.get("position:" + p)),
        department: String(f.get("department:" + p)),
      })),
      reason: String(f.get("reason")),
    });
  }
  return localizeContent(
    <form onSubmit={submit} className="master-form">
      <div className="form-grid">
        <label className="field-label">
          नाम
          <input
            name="name"
            defaultValue={staff?.name}
            required
            minLength={2}
            maxLength={150}
          />
        </label>
        <label className="field-label">
          मोबाइल
          <input
            name="phone"
            inputMode="numeric"
            defaultValue={staff?.phone}
            pattern="[6-9][0-9]{9}"
            required
          />
        </label>
      </div>
      <label className="field-label">
        ईमेल (वैकल्पिक)
        <input
          type="email"
          name="email"
          defaultValue={staff?.email || ""}
          maxLength={254}
        />
      </label>
      <fieldset className="workplace-fieldset">
        <legend>नियुक्त कार्यस्थल / पंचायतें</legend>
        <p>
          एक या अधिक कार्यस्थल चुनें। एक बार की उपस्थिति सभी चुने हुए स्थलों में
          दिखेगी।
        </p>
        <div className="workplace-picker">
          {panchayats.map((p) => (
            <label className="checkbox" key={p}>
              <input
                type="checkbox"
                checked={places.includes(p)}
                onChange={(e) =>
                  setPlaces(
                    e.target.checked
                      ? [...places, p]
                      : places.filter((x) => x !== p),
                  )
                }
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      {places.map((p) => {
        const a = staff?.assignments.find((a) => a.panchayat === p);
        return (
          <fieldset className="assignment-fields" key={p}>
            <legend>{p}</legend>
            <div className="form-grid">
              <label className="field-label">
                पद
                <input
                  name={"position:" + p}
                  list="master-positions"
                  defaultValue={
                    a?.position || staff?.assignments[0]?.position || ""
                  }
                  required
                  minLength={2}
                />
              </label>
              <label className="field-label">
                विभाग
                <input
                  name={"department:" + p}
                  defaultValue={
                    a?.department ||
                    staff?.assignments[0]?.department ||
                    "पंचायती राज विभाग"
                  }
                  required
                  minLength={2}
                />
              </label>
            </div>
          </fieldset>
        );
      })}
      <datalist id="master-positions">
        {positions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {staff && (
        <div className="master-options">
          <label className="checkbox">
            <input
              type="checkbox"
              name="active"
              defaultChecked={staff.active}
            />
            खाता सक्रिय
          </label>
          <label className="checkbox">
            <input type="checkbox" name="reset_device" />
            डिवाइस बाइंडिंग रीसेट करें
          </label>
        </div>
      )}
      <label className="field-label">
        बदलाव का कारण
        <input name="reason" required minLength={10} maxLength={1000} />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy
          ? "सुरक्षित कर रहे हैं…"
          : staff
            ? "बदलाव सुरक्षित करें"
            : "कर्मी जोड़ें"}
      </button>
    </form>,
    language,
  );
}
