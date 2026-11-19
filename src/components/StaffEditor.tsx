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
  blocks: { id: string; name_en: string; district_name?: string }[];
  remove?: boolean;
  staff: Profile[];
  onClose: () => void;
  onSaved: (profile?: Profile, removedId?: string) => void;
  onFound: (phone: string, removed: boolean) => void;
}) {
  const [availableBlocks, setAvailableBlocks] = useState(blocks);
  const [districtNames, setDistrictNames] = useState<string[]>(["Araria"]);
  const [staffScope, setStaffScope] = useState<"block" | "district">(
    person?.staff_scope || "block",
  );
  const [districtName, setDistrictName] = useState(
    person?.district_name || "Araria",
  );
  const [blockText, setBlockText] = useState(person?.block || block || "");
  useEffect(() => {
    if (role !== "dpro") return;
    void fetch("/api/districts")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) =>
        setDistrictNames(
          data.districts.map((item: { name: string }) => item.name),
        ),
      )
      .catch(() => {});
  }, [role]);
  const dialog = useRef<HTMLDialogElement>(null);
  const saveInFlight = useRef(false);
  const createAttempt = useRef({ fingerprint: "", id: "" });
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
            (availableBlocks.find((b) => b.id === selectedBlockId)?.name_en ||
              block),
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
    if (busy || saveInFlight.current) return;
    saveInFlight.current = true;
    const generateLogin =
      person?.roster_only &&
      (event.nativeEvent as SubmitEvent).submitter instanceof
        HTMLButtonElement &&
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)
        .value === "generate-login";
    setBusy(true);
    setError("");
    setDuplicate(null);
    try {
      let homeId = selectedBlockId;
      let resolvedAssignments = assignments;
      const resolveBlock = async (text: string, id?: string) => {
        const existing = availableBlocks.find(
          (item) => item.id === id || item.name_en === text.trim(),
        );
        if (existing) {
          if ((existing.district_name || "Araria") !== districtName.trim())
            throw Error("Choose a block in the selected district.");
          return existing;
        }
        if (role !== "dpro") throw Error("Choose your assigned block.");
        const response = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: text.trim(),
            district_name: districtName.trim(),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Could not add block.");
        setAvailableBlocks((old) => [
          ...old.filter((item) => item.id !== data.block.id),
          data.block,
        ]);
        return data.block as {
          id: string;
          name_en: string;
          district_name?: string;
        };
      };
      if (!remove) {
        const home = await resolveBlock(blockText || block, selectedBlockId);
        homeId = home.id;
        const resolved = [];
        for (const item of assignments) {
          const workplaceBlock =
            staffScope === "district"
              ? await resolveBlock(
                  item.block || home.name_en,
                  item.block_id || (item.block ? undefined : home.id),
                )
              : home;
          const name = item.panchayat.trim();
          if (
            !places.some(
              (place) =>
                place.name === name && place.block === workplaceBlock.name_en,
            )
          ) {
            const response = await fetch("/api/panchayats", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, block_id: workplaceBlock.id }),
            });
            const data = await response.json();
            if (!response.ok)
              throw Error(data.error || "Could not save panchayat.");
          }
          resolved.push({
            ...item,
            panchayat: name,
            block_id: workplaceBlock.id,
            block: workplaceBlock.name_en,
          });
        }
        resolvedAssignments = resolved;
      }
      const fingerprint = JSON.stringify({
        name,
        phone,
        email,
        gender,
        homeId,
        staffScope,
        districtName,
        resolvedAssignments,
      });
      if (!person && createAttempt.current.fingerprint !== fingerprint)
        createAttempt.current = { fingerprint, id: crypto.randomUUID() };
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
                    block_id: homeId,
                    name: name.trim(),
                    phone,
                    email: email.trim(),
                    gender,
                    active,
                    assignments: resolvedAssignments,
                    staff_scope: staffScope,
                    district_name: districtName.trim(),
                  },
                }
              : {
                  action: "create",
                  request_id: createAttempt.current.id,
                  name: name.trim(),
                  phone,
                  email: email.trim(),
                  gender,
                  block_id: homeId,
                  assignments: resolvedAssignments,
                  staff_scope: staffScope,
                  district_name: districtName.trim(),
                },
        ),
      });
      let data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.existing)
          setDuplicate(data.existing);
        throw Error(
          data.error || "कर्मी सहेजा नहीं गया। / Could not save staff.",
        );
      }
      onSaved(data.profile, remove ? person!.id : undefined);
      if (generateLogin) {
        const provision = await fetch("/api/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({ action: "provision", id: person!.id }),
        });
        data = await provision.json();
        if (!provision.ok)
          throw Error(data.error || "Could not generate staff login.");
        onSaved(data.profile);
      }
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
      saveInFlight.current = false;
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
              ? "कर्मी स्थायी रूप से हटाएँ / Permanently remove staff"
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
                  This staff login will be permanently removed from the current
                  directory. Previous attendance will be retained.
                </p>
              ) : (
                <>
                  <div className="sp-grid">
                    {role === "dpro" && (
                      <>
                        <label className="sp-field">
                          कर्मी प्रकार / Staff level
                          <select
                            value={staffScope}
                            onChange={(e) =>
                              setStaffScope(
                                e.target.value as "block" | "district",
                              )
                            }
                          >
                            <option value="block">Block staff</option>
                            <option
                              value="district"
                              disabled={!!person?.roster_only}
                            >
                              District staff
                            </option>
                          </select>
                        </label>
                        <label className="sp-field">
                          जिला / District
                          <input
                            required
                            minLength={2}
                            maxLength={100}
                            list="staff-districts"
                            value={districtName}
                            onChange={(e) => {
                              setDistrictName(e.target.value);
                              setSelectedBlockId("");
                              setBlockText("");
                            }}
                          />
                          <datalist id="staff-districts">
                            {districtNames.map((name) => (
                              <option key={name} value={name} />
                            ))}
                          </datalist>
                        </label>
                        <label className="sp-field">
                          {staffScope === "district"
                            ? "मुख्य कार्यालय का प्रखंड / Primary office block"
                            : "प्रखंड / Block"}
                          <input
                            required
                            minLength={2}
                            maxLength={100}
                            list="staff-blocks"
                            value={blockText}
                            onChange={(e) => {
                              setBlockText(e.target.value);
                              setSelectedBlockId(
                                availableBlocks.find(
                                  (item) => item.name_en === e.target.value,
                                )?.id || "",
                              );
                            }}
                          />
                        </label>
                        <datalist id="staff-blocks">
                          {availableBlocks
                            .filter(
                              (item) =>
                                (item.district_name || "Araria") ===
                                districtName.trim(),
                            )
                            .map((item) => (
                              <option key={item.id} value={item.name_en} />
                            ))}
                        </datalist>
                      </>
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
                        required
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
                        {!active && (
                          <small>
                            This account cannot sign in. Set it to Active, check
                            its mobile number and assignments, then save. For a
                            directory entry without a login, use Generate login.
                          </small>
                        )}
                      </label>
                    )}
                  </div>
                  <h3>आवंटन / Assignments</h3>
                  <div className="sp-actions">
                    <label className="sp-field">
                      नई पंचायत / New panchayat
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
                      पंचायत जोड़ें / Add panchayat
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
                      {staffScope === "district" && role === "dpro" && (
                        <label className="sp-field">
                          कार्यस्थल का प्रखंड / Workspace block
                          <input
                            required
                            list="staff-blocks"
                            minLength={2}
                            maxLength={100}
                            value={
                              a.block ||
                              availableBlocks.find(
                                (item) => item.id === a.block_id,
                              )?.name_en ||
                              blockText
                            }
                            onChange={(e) => {
                              assignment(index, "block", e.target.value);
                              assignment(
                                index,
                                "block_id",
                                availableBlocks.find(
                                  (item) => item.name_en === e.target.value,
                                )?.id || "",
                              );
                            }}
                          />
                        </label>
                      )}

                      <label className="sp-field">
                        पंचायत / Panchayat
                        <input
                          required
                          minLength={2}
                          maxLength={200}
                          list={`staff-panchayats-${index}`}
                          placeholder="चुनें या लिखें / Choose or type"
                          value={a.panchayat}
                          onChange={(e) =>
                            assignment(index, "panchayat", e.target.value)
                          }
                        />
                        <datalist id={`staff-panchayats-${index}`}>
                          {(staffScope === "district"
                            ? [
                                ...new Set(
                                  places
                                    .filter(
                                      (place) =>
                                        place.block ===
                                        (a.block ||
                                          availableBlocks.find(
                                            (item) => item.id === a.block_id,
                                          )?.name_en ||
                                          blockText),
                                    )
                                    .map((place) => place.name),
                                ),
                              ]
                            : panchayats
                          ).map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
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

              <div className="sp-actions">
                <button className="sp-button sp-primary" disabled={busy}>
                  {busy
                    ? "सहेजा जा रहा है…"
                    : remove
                      ? "स्थायी हटाने की पुष्टि / Confirm permanent removal"
                      : "सहेजें / Save"}
                </button>
                {person?.roster_only && !remove && (
                  <button
                    className="sp-button sp-secondary"
                    type="submit"
                    value="generate-login"
                    disabled={busy || !active || !/^[6-9]\d{9}$/.test(phone)}
                  >
                    लॉगिन बनाएँ / Generate login
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        )}
      </dialog>
    </Localized>
  );
}
