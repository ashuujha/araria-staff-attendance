"use client";

import { useEffect, useRef, useState } from "react";
import {
  cameraLocation,
  MAX_CAMERA_ACCURACY_METERS,
  type CameraLocation,
} from "../lib/osm-camera";
import { getFreshLocation } from "../lib/location";
import { prepareWorkplacePhoto } from "../lib/photo-upload";

type Capture = { file: File; location: CameraLocation };
type StampDetails = {
  place: string | null;
  address: string | null;
  map: string | null;
};

async function lookupStamp(
  location: CameraLocation,
  signal: AbortSignal,
): Promise<StampDetails | null> {
  const lookup = new AbortController();
  const abort = () => lookup.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 5_000);
  try {
    const query = new URLSearchParams({
      lat: location.latitude.toFixed(6),
      lon: location.longitude.toFixed(6),
    });
    const response = await fetch(`/api/location-stamp?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: lookup.signal,
    });
    if (!response.ok) return null;
    const result = await response.json();
    return {
      place:
        typeof result.place === "string" ? result.place.slice(0, 150) : null,
      address:
        typeof result.address === "string"
          ? result.address.slice(0, 500)
          : null,
      map:
        typeof result.map === "string" &&
        result.map.startsWith("data:image/png;base64,")
          ? result.map
          : null,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function mapImage(
  dataUrl: string | null,
): Promise<HTMLImageElement | null> {
  if (!dataUrl) return null;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

async function currentPosition(signal: AbortSignal) {
  if (!navigator.geolocation)
    throw new Error(
      "इस ब्राउज़र में स्थान उपलब्ध नहीं है। / Location is unavailable in this browser.",
    );
  return getFreshLocation(navigator.geolocation, signal, {
    maxAccuracyMeters: MAX_CAMERA_ACCURACY_METERS,
    settleMs: 4_000,
    timeoutMs: 25_000,
  });
}

function frameFromVideo(video: HTMLVideoElement): HTMLCanvasElement {
  if (!video.videoWidth || !video.videoHeight)
    throw new Error("कैमरा तैयार नहीं है। / Camera is not ready.");
  const canvas = document.createElement("canvas");
  // A consistent portrait image keeps both the face and the GPS stamp visible
  // in the compact preview and in the administrator's evidence viewer.
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("फोटो नहीं बन सकी। / Could not create the photo.");
  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = video.videoWidth / video.videoHeight;
  const sourceWidth =
    sourceRatio > targetRatio
      ? video.videoHeight * targetRatio
      : video.videoWidth;
  const sourceHeight =
    sourceRatio > targetRatio
      ? video.videoHeight
      : video.videoWidth / targetRatio;
  ctx.drawImage(
    video,
    (video.videoWidth - sourceWidth) / 2,
    (video.videoHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

async function photoFromFrame(
  canvas: HTMLCanvasElement,
  location: CameraLocation,
  mode: "arrival" | "departure",
  details: StampDetails | null,
): Promise<File> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("फोटो नहीं बन सकी। / Could not create the photo.");
  const band = 250;
  const top = canvas.height - band;
  ctx.fillStyle = "rgba(9, 24, 40, 0.88)";
  ctx.fillRect(0, top, canvas.width, band);
  ctx.fillStyle = "#4fc2de";
  ctx.fillRect(0, top, 6, band);
  ctx.textBaseline = "top";
  const map = await mapImage(details?.map || null);
  if (map) {
    ctx.drawImage(map, 20, top + 34, 205, 145);
  } else {
    ctx.fillStyle = "#183e56";
    ctx.fillRect(20, top + 34, 205, 145);
    ctx.fillStyle = "#67d2e6";
    ctx.font = "700 52px sans-serif";
    ctx.fillText("⌖", 101, top + 62);
    ctx.font = "700 18px sans-serif";
    ctx.fillText("GPS", 104, top + 128);
  }
  ctx.fillStyle = "#c9e1ec";
  ctx.font = "500 12px sans-serif";
  ctx.fillText("© OpenStreetMap contributors", 20, top + 194);
  ctx.fillStyle = "#fff";
  const recorded = new Date(location.capturedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const textX = 245;
  const textWidth = canvas.width - textX - 18;
  const drawLines = (
    value: string,
    y: number,
    font: string,
    lineHeight: number,
    limit: number,
  ) => {
    ctx.font = font;
    const words = value
      .replace(/[\u0000-\u001f]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const lines: string[] = [];
    for (const word of words) {
      const index = lines.length - 1;
      if (
        index >= 0 &&
        ctx.measureText(`${lines[index]} ${word}`).width <= textWidth
      )
        lines[index] += ` ${word}`;
      else lines.push(word);
    }
    lines
      .slice(0, limit)
      .forEach((line, index) =>
        ctx.fillText(line, textX, y + index * lineHeight, textWidth),
      );
  };
  ctx.font = "700 20px sans-serif";
  ctx.fillText(
    mode === "departure" ? "ARARIA · DEPARTURE" : "ARARIA · ARRIVAL",
    textX,
    top + 17,
  );
  drawLines(
    details?.place ? `NEAR ${details.place}` : "PLACE NAME UNAVAILABLE",
    top + 48,
    "700 23px sans-serif",
    25,
    2,
  );
  ctx.fillStyle = "#c6e9f2";
  drawLines(
    details?.address || "GPS coordinates recorded",
    top + 105,
    "500 15px sans-serif",
    19,
    2,
  );
  ctx.font = "500 18px sans-serif";
  ctx.fillText(
    `Lat ${location.latitude.toFixed(6)}°  Long ${location.longitude.toFixed(6)}°`,
    textX,
    top + 159,
    textWidth,
  );
  ctx.fillText(`${recorded} IST`, textX, top + 187, textWidth);
  ctx.fillStyle = "#fff";
  ctx.font = "500 15px sans-serif";
  ctx.fillText(
    `Device GPS accuracy ±${Math.round(location.accuracy)} m`,
    textX,
    top + 216,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(
              new File([blob], `araria-workplace-${Date.now()}.jpg`, {
                type: "image/jpeg",
              }),
            )
          : reject(
              new Error("फोटो नहीं बन सकी। / Could not create the photo."),
            ),
      "image/jpeg",
      0.82,
    ),
  );
}

export default function WorkplaceCamera({
  onUse,
  onClose,
  mode = "arrival",
}: {
  onUse: (file: File, location: CameraLocation) => void;
  onClose: () => void;
  mode?: "arrival" | "departure";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const locationRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookingUpPlace, setLookingUpPlace] = useState(false);
  const [error, setError] = useState("");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "कैमरा इस ब्राउज़र में उपलब्ध नहीं है। HTTPS पर साइट खोलें। / Camera unavailable. Open this site over HTTPS.",
      );
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "user" } },
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "कैमरा अनुमति दें और फिर कोशिश करें। / Allow camera access and retry.",
          );
      });
    return () => {
      cancelled = true;
      active.current = false;
      locationRequest.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, []);

  useEffect(() => {
    if (!capture) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(capture.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [capture]);

  async function takePhoto() {
    if (!ready || !video.current || busy) return;
    setBusy(true);
    setError("");
    setCapture(null);
    setLocationConfirmed(false);
    const controller = new AbortController();
    locationRequest.current = controller;
    try {
      const position = await currentPosition(controller.signal);
      const location = cameraLocation(position);
      if (!active.current || !video.current) return;
      const frame = frameFromVideo(video.current);
      setLookingUpPlace(true);
      const details = await lookupStamp(location, controller.signal);
      if (!active.current) return;
      const original = await photoFromFrame(frame, location, mode, details);
      const compressed =
        original.size >= 5 * 1024 * 1024
          ? await prepareWorkplacePhoto(original)
          : original;
      const file =
        compressed === original
          ? original
          : new File([compressed], original.name, { type: "image/jpeg" });
      if (active.current) setCapture({ file, location });
    } catch (cause) {
      if (active.current)
        setError(
          typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            cause.code === 1
            ? "स्थान की अनुमति दें और फिर कोशिश करें। / Allow location access and retry."
            : cause instanceof Error
              ? cause.message
              : "स्थान नहीं मिला। फिर कोशिश करें। / Location unavailable. Retry.",
        );
    } finally {
      if (locationRequest.current === controller)
        locationRequest.current = null;
      if (active.current) {
        setBusy(false);
        setLookingUpPlace(false);
      }
    }
  }

  return (
    <div className="sp-capture sp-workplace-camera">
      <video
        ref={video}
        className="sp-camera"
        style={{ display: capture ? "none" : "block" }}
        autoPlay
        muted
        playsInline
        aria-label="Live workplace camera"
      />
      {error && (
        <p role="alert" className="sp-alert sp-error">
          {error}
        </p>
      )}
      {capture && (
        <div className="sp-camera-review">
          {preview && (
            <img
              className="sp-camera"
              src={preview}
              alt="Captured workplace photo with location and time stamp"
            />
          )}
          <label className="sp-camera-confirmation">
            <input
              type="checkbox"
              checked={locationConfirmed}
              onChange={(event) => setLocationConfirmed(event.target.checked)}
            />
            <span>
              फोटो पर दिखाया GPS स्थान और समय सही है / The GPS location and time
              on this photo are correct.
            </span>
          </label>
        </div>
      )}
      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-primary"
          disabled={!ready || busy}
          onClick={() => void takePhoto()}
        >
          {busy
            ? lookingUpPlace
              ? "फोटो में स्थान जोड़ा जा रहा है… / Adding place to photo…"
              : "स्थान लिया जा रहा है… / Locating…"
            : capture
              ? "फिर से लें / Retake"
              : "फ़ोटो लें / Take photo"}
        </button>
        {capture && (
          <button
            type="button"
            className="sp-button sp-secondary"
            disabled={!locationConfirmed}
            onClick={() => {
              onUse(capture.file, capture.location);
              onClose();
            }}
          >
            यह फ़ोटो इस्तेमाल करें / Use photo
          </button>
        )}
        <button
          type="button"
          className="sp-button sp-secondary"
          onClick={onClose}
        >
          बंद करें / Close
        </button>
      </div>
    </div>
  );
}
