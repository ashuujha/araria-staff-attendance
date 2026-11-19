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
  // A consistent portrait image keeps the staff photo easy to inspect.
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

async function photoFromFrame(canvas: HTMLCanvasElement): Promise<File> {
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
  const [error, setError] = useState("");
  const [capture, setCapture] = useState<Capture | null>(null);
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
    const controller = new AbortController();
    locationRequest.current = controller;
    try {
      const position = await currentPosition(controller.signal);
      const location = cameraLocation(position);
      if (!active.current || !video.current) return;
      const frame = frameFromVideo(video.current);
      const original = await photoFromFrame(frame);
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
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="sp-capture sp-workplace-camera">
      <video
        ref={video}
        className="sp-camera sp-camera-live"
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
              className="sp-camera sp-camera-photo"
              src={preview}
              alt="Captured staff photo"
            />
          )}
        </div>
      )}
      <div
        className={`sp-actions sp-camera-actions ${capture ? "is-review" : "is-live"}`}
      >
        <button
          type="button"
          className="sp-button sp-primary"
          disabled={!ready || busy}
          onClick={() => void takePhoto()}
        >
          {busy
            ? "स्थान लिया जा रहा है… / Locating…"
            : capture
              ? "Retake"
              : "Take photo"}
        </button>
        {capture && (
          <button
            type="button"
            className="sp-button sp-secondary"
            disabled={busy}
            onClick={() => {
              onUse(capture.file, capture.location);
              onClose();
            }}
          >
            Use photo
          </button>
        )}
        <button
          type="button"
          className="sp-button sp-secondary"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
