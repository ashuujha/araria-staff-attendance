"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Localized } from "../lib/portal-language";
import type { OfficeFeed, OfficeNotice } from "../lib/office-types";

export function useOfficeFeed(initial?: OfficeFeed) {
  const [feed, setFeed] = useState<OfficeFeed | null>(initial || null);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/office", {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Office board unavailable");
      if (alive.current && current === generation.current) {
        setFeed(data);
        setError("");
      }
      return true;
    } catch (err) {
      if (alive.current && current === generation.current)
        setError(
          err instanceof Error ? err.message : "Office board unavailable",
        );
      return false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!initial) void reload();
    const update = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [reload, initial]);
  return { feed, error, reload };
}

export function NoticeBoard({ notices }: { notices: OfficeNotice[] }) {
  return (
    <Localized>
      <section
        className="sp-card sp-notice-board"
        aria-labelledby="notice-board-title"
      >
        <h2 id="notice-board-title">सूचना पट्ट / Notice board</h2>
        {notices.length ? (
          notices.map((notice) => (
            <article key={notice.id} className="sp-notice">
              <h3 translate="no">{notice.title}</h3>
              <time dateTime={notice.created_at}>
                {new Date(notice.created_at).toLocaleDateString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </time>
              <p translate="no" className="sp-notice-body">
                {notice.body}
              </p>
            </article>
          ))
        ) : (
          <p className="sp-muted">अभी कोई सूचना नहीं है। / No notices yet.</p>
        )}
      </section>
    </Localized>
  );
}

export function OfficeSettings({
  feed,
  error,
  reload,
  canManage,
}: {
  feed: OfficeFeed | null;
  error: string;
  reload: () => Promise<boolean>;
  canManage: boolean;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  async function save(payload: object, done?: () => void) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSaveError("");
    try {
      const response = await fetch("/api/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Unable to save");
      done?.();
      if (await reload()) setMessage("सहेज दिया गया। / Saved.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localized>
      <div className="sp-office-settings">
        {message && (
          <p className="sp-alert sp-success" role="status">
            {message}
          </p>
        )}
        {(error || saveError) && (
          <p className="sp-alert sp-error" role="alert">
            {saveError || error}
          </p>
        )}
        {!feed && !error && <p role="status">लोड हो रहा है / Loading…</p>}
        <div className="sp-office-columns">
          <section aria-labelledby="holiday-title">
            <h2 id="holiday-title">अवकाश कैलेंडर / Holiday calendar</h2>
            <p className="sp-muted">
              हर रविवार उपस्थिति बंद है। अन्य अवकाश का कारण यहाँ जोड़ें। /
              Attendance is closed every Sunday. Add other holidays and their
              reasons here.
            </p>
            {canManage && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ action: "set_holiday", date, reason }, () => {
                    setDate("");
                    setReason("");
                  });
                }}
              >
                <fieldset className="sp-form-controls" disabled={busy}>
                  <label className="sp-field">
                    अवकाश की तारीख / Holiday date
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(event) => {
                        setDate(event.target.value);
                        setReason(
                          feed?.holidays.find(
                            (day) => day.date === event.target.value,
                          )?.reason || "",
                        );
                      }}
                    />
                  </label>
                  <label className="sp-field">
                    अवकाश का कारण / Holiday reason
                    <input
                      required
                      minLength={3}
                      maxLength={200}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button className="sp-button sp-primary" disabled={busy}>
                    अवकाश सहेजें / Save holiday
                  </button>
                </fieldset>
              </form>
            )}
            <ul className="sp-office-list">
              {feed?.holidays.map((day) => (
                <li key={day.date}>
                  <div>
                    <time dateTime={day.date}>{day.date}</time>
                    <p translate="no">{day.reason}</p>
                  </div>
                  {canManage && (
                    <div className="sp-actions">
                      <button
                        type="button"
                        className="sp-button sp-secondary"
                        disabled={busy}
                        onClick={() => {
                          setDate(day.date);
                          setReason(day.reason);
                        }}
                      >
                        बदलें / Edit
                      </button>
                      <button
                        type="button"
                        className="sp-button sp-secondary"
                        disabled={busy}
                        onClick={() =>
                          void save({
                            action: "remove_holiday",
                            date: day.date,
                          })
                        }
                      >
                        हटाएँ / Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {feed && !feed.holidays.length && (
              <p className="sp-muted">
                कोई अतिरिक्त अवकाश नहीं है। / No additional holidays.
              </p>
            )}
          </section>
          <section aria-labelledby="notice-settings-title">
            <h2 id="notice-settings-title">
              सूचना प्रकाशित करें / Publish notice
            </h2>
            <p className="sp-muted">
              यह सूचना लॉगिन के बाद सभी कर्मियों को दिखाई देगी। / All staff will
              see this notice after login.
            </p>
            {canManage && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ action: "publish_notice", title, body }, () => {
                    setTitle("");
                    setBody("");
                  });
                }}
              >
                <fieldset className="sp-form-controls" disabled={busy}>
                  <label className="sp-field">
                    सूचना का शीर्षक / Notice title
                    <input
                      required
                      minLength={3}
                      maxLength={150}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label className="sp-field">
                    सूचना का संदेश / Notice message
                    <textarea
                      required
                      minLength={3}
                      maxLength={4000}
                      rows={5}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                    />
                  </label>
                  <button className="sp-button sp-primary" disabled={busy}>
                    प्रकाशित करें / Publish
                  </button>
                </fieldset>
              </form>
            )}
            <ul className="sp-office-list">
              {feed?.notices.map((notice) => (
                <li key={notice.id}>
                  <div>
                    <strong translate="no">{notice.title}</strong>
                    <p translate="no" className="sp-notice-body">
                      {notice.body}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      className="sp-button sp-secondary"
                      disabled={busy}
                      onClick={() =>
                        void save({ action: "remove_notice", id: notice.id })
                      }
                    >
                      हटाएँ / Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <button
          type="button"
          className="sp-button sp-secondary"
          onClick={() => void reload()}
          disabled={busy}
        >
          रीफ़्रेश / Refresh
        </button>
      </div>
    </Localized>
  );
}
