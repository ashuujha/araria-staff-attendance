"use client";
import { useEffect, useRef, useState } from "react";
import type { Profile, Assignment } from "../lib/types";
import { Localized } from "../lib/portal-language";
import { PANCHAYATI_RAJ_DEPARTMENT } from "../lib/district";

export default function StaffEditor({
  person,
  block,
  blockId,
  role,
  blocks,
  remove = false,
  staff,
  onClose,
  onSaved,
  onFound,
}: {
  person: Profile | null;
  block: string;
  blockId: string;
  role: "bpro" | "dpro";
  blocks: { id: string; name_en: string }[];
  remove?: boolean;
  staff: Profile[];
  onClose: () => void;
  onSaved: (profile?: Profile, removedId?: string) => void;
  onFound: (phone: string, removed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(person?.name || "");
  const [phone, setPhone] = useState(person?.phone || "");
  const [email, setEmail] = useState(person?.email || "");
  const [gender, setGender] = useState(person?.gender || "");
  const [active, setActive] = useState(person?.active ?? true);
  const [selectedBlockId, setSelectedBlockId] = useState(
    person?.block_id || blockId || "",
  );
  const [assignments, setAssignments] = useState<Assignment[]>(
    person?.assignments.length
      ? person.assignments.map((a) => ({ ...a }))
      : [
          {
            department: PANCHAYATI_RAJ_DEPARTMENT,
            panchayat: "",
            position: "",
          },
        ],
  );
  const [places, setPlaces] = useState<{ name: string; block: string }[]>([]);
  const [placesError, setPlacesError] = useState(false);
  const [newPlace, setNewPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<{
    name: string;
    phone: string;
    removed: boolean;
  } | null>(null);
  const [done, setDone] = useState(false);
  const [credentials, setCredentials] = useState<{
    login: string;
    password: string;
  } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (remove) return;
    const controller = new AbortController();
    void fetch("/api/panchayats", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => setPlaces(data.panchayats || []))
      .catch(() => {
        if (!controller.signal.aborted) setPlacesError(true);
      });
    return () => controller.abort();
  }, [remove]);
  const existing = staff.flatMap((p) => p.assignments);
  const positions = [...new Set(existing.map((a) => a.position))].sort();
  const panchayats = [
    ...new Set([
      ...places
        .filter(
          (p) =>
            p.block ===
            (blocks.find((b) => b.id === selectedBlockId)?.name_en || block),
        )
        .map((p) => p.name),
      ...assignments.map((a) => a.panchayat).filter(Boolean),
    ]),
  ].sort();
  function assignment(index: number, key: keyof Assignment, value: string) {
    setAssignments((old) =>
      old.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  }
  async function addWorkspace() {
    if (!newPlace.trim() || !selectedBlockId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/panchayats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPlace.trim(),
          block_id: selectedBlockId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not add workspace.");
      setPlaces((old) => [...old, data.workspace]);
      setNewPlace("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add workspace.");
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setDuplicate(null);
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify(
          remove
            ? { action: "delete", id: person!.id }
            : person
              ? {
                  action: "update",
                  id: person.id,
                  changes: {
                    block_id: selectedBlockId,
                    name: name.trim(),
                    phone,
                    email: email.trim(),
                    gender,
                    active,
                    assignments,
                  },
                }
              : {
                  action: "create",
                  name: name.trim(),
                  phone,
                  email: email.trim(),
                  gender,
                  block_id: selectedBlockId,
                  assignments,
                },
        ),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.existing)
          setDuplicate(data.existing);
        throw Error(
          data.error || "कर्मी सहेजा नहीं गया। / Could not save staff.",
        );
      }
      onSaved(data.profile, remove ? person!.id : undefined);
      if (data.password) {
        setCredentials({ login: phone, password: data.password });
        setDone(true);
      } else onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.name !== "TimeoutError"
          ? err.message
          : "अनुरोध में देर हो रही है। रीफ़्रेश करके बदलाव जाँचें। / Request timed out. Refresh to check whether the change was saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localized>
      <dialog
        ref={dialog}
        className="sp-dialog"
        aria-labelledby="staff-editor-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) onClose();
        }}
      >
        <div className="sp-dialog-header">
          <h2 id="staff-editor-title">
            {remove
              ? "कर्मी हटाएँ / Remove staff"
              : person
                ? "कर्मी विवरण बदलें / Edit staff"
                : "कर्मी जोड़ें / Add staff"}
          </h2>
          <button
            type="button"
            className="sp-button sp-secondary"
            disabled={busy}
            onClick={onClose}
          >
            बंद करें / Close
          </button>
        </div>
        {error && (
          <div role="alert" className="sp-alert sp-error">
            <p>{error}</p>
            {duplicate && (
              <button
                type="button"
                className="sp-button sp-secondary"
                onClick={() => onFound(duplicate.phone, duplicate.removed)}
              >
                {duplicate.name} —{" "}
                {duplicate.removed ? "Removed staff" : "Staff directory"} में
                देखें / View
              </button>
            )}
          </div>
        )}
        {done && credentials ? (
          <div role="status" className="sp-alert sp-success">
            <p>
              नया कर्मी जुड़ गया। लॉगिन विवरण दें। / Staff added. Share these
              login details.
            </p>
            <p translate="no">{name}</p>
            <dl className="sp-details">
              <div>
                <dt>मोबाइल नंबर / Mobile number</dt>
                <dd translate="no">{credentials.login}</dd>
              </div>
              <div>
                <dt>पासवर्ड / Password</dt>
                <dd translate="no">{credentials.password}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <form onSubmit={save}>
            <fieldset className="sp-form-controls" disabled={busy}>
              {remove ? (
                <p>
                  <span translate="no">
                    {person?.name} ({person?.phone})
                  </span>
                  <br />
                  इस कर्मी का लॉगिन बंद होगा। पुरानी उपस्थिति सुरक्षित रहेगी। /
                  This staff login will be disabled. Previous attendance will be
                  retained.
                </p>
              ) : (
                <>
                  <div className="sp-grid">
                    {role === "dpro" && (
                      <label className="sp-field">
                        प्रखंड / Block
                        <select
                          required
                          value={selectedBlockId}
                          onChange={(e) => {
                            setSelectedBlockId(e.target.value);
                            setAssignments((old) =>
                              old.map((a) => ({ ...a, panchayat: "" })),
                            );
                          }}
                        >
                          <option value="">Choose block</option>
                          {blocks.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name_en}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="sp-field">
                      नाम / Name
                      <input
                        required
                        minLength={2}
                        maxLength={150}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label className="sp-field">
                      मोबाइल नंबर / Mobile number
                      <input
                        required={!!person && !person.roster_only}
                        type="tel"
                        pattern="[6-9][0-9]{9}"
                        maxLength={10}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                    <label className="sp-field">
                      ईमेल / Email
                      <input
                        type="email"
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <label className="sp-field">
                      लिंग / Gender (SL eligibility)
                      <select
                        required={!!person && !person.roster_only}
                        value={gender}
                        onChange={(event) =>
                          setGender(
                            event.target.value as "female" | "male" | "",
                          )
                        }
                      >
                        <option value="">चुनें / Choose</option>
                        <option value="female">महिला / Female</option>
                        <option value="male">पुरुष / Male</option>
                      </select>
                    </label>
                    {person && (
                      <label className="sp-field">
                        {person.roster_only
                          ? "सूची स्थिति / Directory status"
                          : "खाता स्थिति / Account status"}
                        <select
                          value={active ? "active" : "inactive"}
                          onChange={(e) =>
                            setActive(e.target.value === "active")
                          }
                        >
                          <option value="active">सक्रिय / Active</option>
                          <option value="inactive">निष्क्रिय / Inactive</option>
                        </select>
                      </label>
                    )}
                  </div>
                  <h3>आवंटन / Assignments</h3>
                  <div className="sp-actions">
                    <label className="sp-field">
                      New workspace / नया कार्यस्थल
                      <input
                        value={newPlace}
                        maxLength={200}
                        onChange={(event) => setNewPlace(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="sp-button sp-secondary"
                      disabled={
                        busy || !selectedBlockId || newPlace.trim().length < 2
                      }
                      onClick={() => void addWorkspace()}
                    >
                      Add workspace
                    </button>
                  </div>
                  {placesError && (
                    <p role="status">
                      पंचायत सूची लोड नहीं हुई। फिर से फॉर्म खोलें। / Panchayat
                      list could not load. Reopen this form to retry.
                    </p>
                  )}
                  {assignments.map((a, index) => (
                    <div className="sp-editor-assignment" key={index}>
                      <label className="sp-field">
                        पंचायत / Panchayat
                        <select
                          required
                          value={a.panchayat}
                          onChange={(e) =>
                            assignment(index, "panchayat", e.target.value)
                          }
                        >
                          <option value="">चुनें / Choose</option>
                          {panchayats.map((p) => (
                            <option key={p} translate="no">
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="sp-field">
                        पद / Position
                        <input
                          required
                          minLength={2}
                          maxLength={200}
                          list="staff-positions"
                          value={a.position}
                          onChange={(e) =>
                            assignment(index, "position", e.target.value)
                          }
                        />
                      </label>
                      {assignments.length > 1 && (
                        <button
                          type="button"
                          className="sp-button sp-secondary"
                          onClick={() =>
                            setAssignments((old) =>
                              old.filter((_, i) => i !== index),
                            )
                          }
                        >
                          आवंटन हटाएँ / Remove assignment
                        </button>
                      )}
                    </div>
                  ))}
                  <datalist id="staff-positions">
                    {positions.map((value) => (
                      <option key={value} value={value} translate="no" />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="sp-button sp-secondary"
                    disabled={assignments.length >= 31}
                    onClick={() =>
                      setAssignments((old) => [
                        ...old,
                        {
                          department: PANCHAYATI_RAJ_DEPARTMENT,
                          panchayat: "",
                          position: "",
                        },
                      ])
                    }
                  >
                    आवंटन जोड़ें / Add assignment
                  </button>
                </>
              )}

              <button className="sp-button sp-primary" disabled={busy}>
                {busy
                  ? "सहेजा जा रहा है…"
                  : remove
                    ? "हटाने की पुष्टि / Confirm removal"
                    : "सहेजें / Save"}
              </button>
            </fieldset>
          </form>
        )}
      </dialog>
    </Localized>
  );
}
