"use client";

import { useEffect, useRef, useState } from "react";
import {
  cameraLocation,
  isNearArariaDistrict,
  MAX_CAMERA_ACCURACY_METERS,
  openStreetMapEmbedUrl,
  openStreetMapUrl,
  type CameraLocation,
} from "../lib/osm-camera";
import { getFreshLocation } from "../lib/location";

type Capture = { file: File; location: CameraLocation };

async function currentPosition(
  requireDistrictLocation: boolean,
  signal: AbortSignal,
) {
  if (!navigator.geolocation)
    throw new Error(
      "इस ब्राउज़र में स्थान उपलब्ध नहीं है। / Location is unavailable in this browser.",
    );
  let sawOutsideDistrict = false;
  try {
    return await getFreshLocation(navigator.geolocation, signal, {
      maxAccuracyMeters: MAX_CAMERA_ACCURACY_METERS,
      settleMs: 4_000,
      timeoutMs: 25_000,
      acceptPosition: requireDistrictLocation
        ? (position) => {
            const nearby = isNearArariaDistrict(position.coords);
            if (!nearby) sawOutsideDistrict = true;
            return nearby;
          }
        : undefined,
    });
  } catch (cause) {
    if (sawOutsideDistrict)
      throw new Error(
        "आपका फ़ोन अररिया ज़िले के बाहर का स्थान दिखा रहा है। फ़ोन की सटीक स्थान सेवा चालू करें और फिर कोशिश करें। / Your device reports a location outside Araria district. Enable Precise Location and retry outdoors.",
      );
    throw cause;
  }
}

function photoFromVideo(
  video: HTMLVideoElement,
  location: CameraLocation,
  mode: "arrival" | "departure",
): Promise<File> {
  if (!video.videoWidth || !video.videoHeight)
    throw new Error("कैमरा तैयार नहीं है। / Camera is not ready.");
  const scale = Math.min(
    1,
    1600 / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("फोटो नहीं बन सकी। / Could not create the photo.");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const size = Math.max(15, Math.round(canvas.width / 52));
  const line = size * 1.4;
  const band = line * 5 + 24;
  ctx.fillStyle = "rgba(7, 21, 37, 0.82)";
  ctx.fillRect(0, canvas.height - band, canvas.width, band);
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${size}px sans-serif`;
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
  const lines = [
    mode === "departure"
      ? "ARARIA STAFF • DEPARTURE GPS CAMERA"
      : "ARARIA STAFF • ARRIVAL GPS CAMERA",
    `Lat ${location.latitude.toFixed(6)}°   Lon ${location.longitude.toFixed(6)}°`,
    `Device accuracy ±${Math.round(location.accuracy)} m`,
    `${recorded} IST`,
    "Map: openstreetmap.org (link in attendance details)",
  ];
  lines.forEach((text, index) => {
    let fontSize = size;
    ctx.font = `${index === 0 ? "700" : "500"} ${fontSize}px sans-serif`;
    while (ctx.measureText(text).width > canvas.width - 24 && fontSize > 10) {
      fontSize--;
      ctx.font = `${index === 0 ? "700" : "500"} ${fontSize}px sans-serif`;
    }
    ctx.fillText(text, 12, canvas.height - band + 18 + line * (index + 1));
  });
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
  requireDistrictLocation = false,
}: {
  onUse: (file: File, location: CameraLocation) => void;
  onClose: () => void;
  mode?: "arrival" | "departure";
  requireDistrictLocation?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const locationRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
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
      const position = await currentPosition(
        requireDistrictLocation,
        controller.signal,
      );
      const location = cameraLocation(position);
      if (!active.current || !video.current) return;
      const file = await photoFromVideo(video.current, location, mode);
      if (!file.size || file.size >= 5 * 1024 * 1024)
        throw new Error(
          "फोटो 5 MB से बड़ी है। फिर कोशिश करें। / Photo exceeds 5 MB. Retake it.",
        );
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
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="sp-capture sp-workplace-camera">
      <video
        ref={video}
        className="sp-camera"
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
          <p>
            Device location: {capture.location.latitude.toFixed(6)},{" "}
            {capture.location.longitude.toFixed(6)} • accuracy ±
            {Math.round(capture.location.accuracy)} m
          </p>
          {!isNearArariaDistrict(capture.location) && (
            <p role="status" className="sp-alert sp-error">
              Your device reports a location outside Araria district. If you are
              in Forbesganj or another Araria block, enable Precise Location on
              your phone and retake the photo.
            </p>
          )}
          <iframe
            title="OpenStreetMap view of reported location"
            src={openStreetMapEmbedUrl(capture.location)}
            className="sp-camera-map"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <a
            href={openStreetMapUrl(capture.location)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open reported location in OpenStreetMap
          </a>
          <small>
            Map © OpenStreetMap contributors. Device location can be inaccurate;
            check the marker before use.
          </small>
          <label className="sp-camera-confirmation">
            <input
              type="checkbox"
              checked={locationConfirmed}
              onChange={(event) => setLocationConfirmed(event.target.checked)}
            />
            <span>
              मानचित्र पर मेरा वास्तविक स्थान दिख रहा है / The map marker shows
              my actual location.
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
            ? "स्थान लिया जा रहा है… / Locating…"
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
