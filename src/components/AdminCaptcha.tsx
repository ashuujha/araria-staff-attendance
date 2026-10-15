"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Localized } from "../lib/portal-language";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export default function AdminCaptcha({
  onToken,
  resetKey,
}: {
  onToken: (token: string) => void;
  resetKey: number;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState("");
  const [challenge, setChallenge] = useState("");
  const [image, setImage] = useState("");
  const [answer, setAnswer] = useState("");
  const [providerToken, setProviderToken] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [ready, setReady] = useState(false);
  const [compact, setCompact] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width < 300),
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    callback.current(
      providerToken && challenge && /^[a-zA-Z2-9]{6}$/.test(answer.trim())
        ? JSON.stringify({
            turnstile: providerToken,
            challenge,
            answer: answer.trim(),
          })
        : "",
    );
  }, [providerToken, challenge, answer]);
  useEffect(() => {
    setAnswer("");
    setImage("");
    setChallenge("");
    setError("");
    setLoading(true);
    const controller = new AbortController();
    void fetch("/api/auth/captcha", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (response) => {
        const data = await response.json();
        if (
          !response.ok ||
          typeof data.siteKey !== "string" ||
          typeof data.challenge !== "string" ||
          !data.image?.startsWith("data:image/png;base64,")
        )
          throw Error(
            data.error ||
              "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page.",
          );
        if (!controller.signal.aborted) {
          setSiteKey(data.siteKey);
          setChallenge(data.challenge);
          setImage(data.image);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(
            err.name === "TimeoutError"
              ? "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page."
              : err.message,
          );
        }
      });
    return () => controller.abort();
  }, [resetKey, refresh]);
  useEffect(() => {
    if (!siteKey || ready) return;
    const timer = window.setTimeout(() => {
      setLoading(false);
      setError(
        "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page.",
      );
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [siteKey, ready]);
  useEffect(() => {
    if (!ready || !siteKey || !element.current || !window.turnstile) return;
    const turnstile = window.turnstile;
    setProviderToken("");
    setError("");
    let active = true;
    let widget: string;
    try {
      widget = turnstile.render(element.current, {
        sitekey: siteKey,
        action: "admin_login",
        theme: "light",
        size: compact ? "compact" : "flexible",
        callback: (token: string) => {
          if (active) {
            setLoading(false);
            setError("");
            setProviderToken(token);
          }
        },
        "expired-callback": () => {
          if (active) {
            setProviderToken("");
            setError(
              "CAPTCHA समाप्त हो गया। फिर पूरा करें। / CAPTCHA expired. Please complete it again.",
            );
          }
        },
        "error-callback": () => {
          if (active) {
            setLoading(false);
            setProviderToken("");
            setError(
              "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page.",
            );
          }
          return true;
        },
      });
      setLoading(false);
    } catch {
      setLoading(false);
      setError(
        "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page.",
      );
    }
    return () => {
      active = false;
      if (widget) turnstile.remove(widget);
    };
  }, [ready, siteKey, resetKey, refresh, compact]);
  return (
    <Localized>
      <div className="sp-admin-captcha">
        <div className="sp-field">
          <label htmlFor="admin-captcha-code">
            चित्र का कोड भरें / Enter the code shown
          </label>
          <div className="sp-captcha-image-row">
            {image ? (
              <img
                src={image}
                width={300}
                height={84}
                alt="CAPTCHA कोड का चित्र / CAPTCHA code image"
              />
            ) : (
              <span role="status">चित्र लोड हो रहा है… / Loading image…</span>
            )}
            <button
              type="button"
              className="sp-button sp-secondary"
              onClick={() => setRefresh((value) => value + 1)}
              aria-label="नया CAPTCHA / New CAPTCHA"
              title="नया CAPTCHA / New CAPTCHA"
            >
              ↻
            </button>
          </div>
          <input
            id="admin-captcha-code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            pattern="[a-zA-Z2-9]{6}"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            aria-describedby="admin-captcha-hint"
          />
          <small id="admin-captcha-hint">
            चित्र के 6 अक्षर या अंक लिखें। / Type the 6 letters or numbers in
            the image.
          </small>
        </div>
        {siteKey && (
          <Script
            id="admin-turnstile"
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onReady={() => setReady(true)}
            onError={() => {
              setLoading(false);
              setError(
                "CAPTCHA लोड नहीं हुआ। पेज रीफ़्रेश करें। / CAPTCHA failed to load. Refresh the page.",
              );
            }}
          />
        )}
        <div ref={element} className="sp-provider-captcha" />
        {loading && (
          <p role="status">CAPTCHA लोड हो रहा है… / Loading CAPTCHA…</p>
        )}
        {error && (
          <p role="alert" className="sp-note">
            {error}
          </p>
        )}
      </div>
    </Localized>
  );
}
