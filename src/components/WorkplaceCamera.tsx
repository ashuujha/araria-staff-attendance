"use client";

import { useEffect, useRef, useState } from "react";
import {
  cameraLocation,
  isNearArariaDistrict,
  MAX_CAMERA_ACCURACY_METERS,
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
  const band = 186;
  ctx.fillStyle = "rgba(9, 24, 40, 0.88)";
  ctx.fillRect(0, canvas.height - band, canvas.width, band);
  ctx.fillStyle = "#4fc2de";
  ctx.fillRect(0, canvas.height - band, 6, band);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
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
  const top = canvas.height - band + 20;
  ctx.font = "700 22px sans-serif";
  ctx.fillText(
    mode === "departure" ? "ARARIA · DEPARTURE" : "ARARIA · ARRIVAL",
    24,
    top,
  );
  ctx.fillStyle = "#c6e9f2";
  ctx.font = "500 21px sans-serif";
  ctx.fillText(
    `LAT ${location.latitude.toFixed(6)}°    LON ${location.longitude.toFixed(6)}°`,
    24,
    top + 39,
  );
  ctx.fillText(
    `GPS ±${Math.round(location.accuracy)} m · ${recorded} IST`,
    24,
    top + 75,
  );
  ctx.fillStyle = "#fff";
  ctx.font = "500 18px sans-serif";
  ctx.fillText("PANCHAYATI RAJ · GEO-TAGGED PHOTO", 24, top + 116);
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
          {!isNearArariaDistrict(capture.location) && (
            <p role="status" className="sp-alert sp-error">
              Your device reports a location outside Araria district. If you are
              in Forbesganj or another Araria block, enable Precise Location on
              your phone and retake the photo.
            </p>
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
