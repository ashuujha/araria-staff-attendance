"use client";

import { useEffect, useRef, useState } from "react";

type Request = {
  id: string;
  staff_name?: string;
  leave_type: string;
  date: string;
};

export default function LeaveDecisionDialog({
  request,
  approve,
  busy,
  onClose,
  onSubmit,
}: {
  request: Request;
  approve: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<"drawn" | "uploaded">("drawn");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = "#183c60";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [mode]);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
      y:
        ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
    };
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const form = new FormData();
    form.set("id", request.id);
    form.set("approve", String(approve));
    if (approve) {
      form.set("mode", mode);
      if (mode === "drawn") {
        if (!drawn) {
          setError("Draw your signature before approving.");
          return;
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.current?.toBlob(resolve, "image/png"),
        );
        if (!blob) {
          setError("Signature could not be prepared.");
          return;
        }
        form.set("file", blob, "signature.png");
      } else {
        if (
          !file ||
          !["image/jpeg", "application/pdf"].includes(file.type) ||
          file.size >= 5 * 1024 * 1024
        ) {
          setError("Choose a signed JPEG or PDF smaller than 5 MB.");
          return;
        }
        form.set("file", file);
      }
    } else {
      if (reason.trim().length < 3 || reason.trim().length > 1000) {
        setError("Enter a rejection reason of 3 to 1000 characters.");
        return;
      }
      form.set("reason", reason.trim());
    }
    await onSubmit(form);
  }
  return (
    <div
      className="sp-decision-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="sp-decision-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-decision-title"
      >
        <div className="sp-dialog-header">
          <h2 id="leave-decision-title">
            {approve
              ? "Approve leave / अवकाश स्वीकृत करें"
              : "Reject leave / अवकाश अस्वीकृत करें"}
          </h2>
          <button
            type="button"
            className="sp-button sp-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>
        <p>
          <strong>{request.staff_name}</strong> • {request.leave_type} •{" "}
          {request.date}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {approve ? (
            <>
              <p>
                Return a signed copy to the staff member. Choose how to sign:
              </p>
              <div className="sp-actions">
                <label>
                  <input
                    type="radio"
                    checked={mode === "drawn"}
                    onChange={() => setMode("drawn")}
                  />{" "}
                  Draw signature
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === "uploaded"}
                    onChange={() => setMode("uploaded")}
                  />{" "}
                  Upload signed application
                </label>
              </div>
              {mode === "drawn" ? (
                <>
                  <p className="sp-muted">
                    Sign below with your mouse or finger. A signed decision page
                    will be added to the application.
                  </p>
                  <canvas
                    ref={canvas}
                    width={700}
                    height={220}
                    className="sp-signature-canvas"
                    aria-label="Draw signature"
                    onPointerDown={(event) => {
                      drawing.current = true;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const p = point(event);
                      const ctx = event.currentTarget.getContext("2d");
                      ctx?.beginPath();
                      ctx?.moveTo(p.x, p.y);
                    }}
                    onPointerMove={(event) => {
                      if (!drawing.current) return;
                      const p = point(event);
                      const ctx = event.currentTarget.getContext("2d");
                      ctx?.lineTo(p.x, p.y);
                      ctx?.stroke();
                      setDrawn(true);
                    }}
                    onPointerUp={() => {
                      drawing.current = false;
                    }}
                    onPointerCancel={() => {
                      drawing.current = false;
                    }}
                  />
                  <button
                    type="button"
                    className="sp-button sp-secondary"
                    onClick={() => {
                      const ctx = canvas.current?.getContext("2d");
                      if (ctx) {
                        ctx.fillStyle = "#fff";
                        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                        ctx.fillStyle = "#183c60";
                      }
                      setDrawn(false);
                    }}
                  >
                    Clear signature
                  </button>
                </>
              ) : (
                <label className="sp-field">
                  Signed application (JPEG/PDF, under 5 MB)
                  <input
                    type="file"
                    accept="image/jpeg,application/pdf,.jpg,.jpeg,.pdf"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] || null)
                    }
                    required
                  />
                </label>
              )}
            </>
          ) : (
            <label className="sp-field">
              Reason for rejection (sent to staff)
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                maxLength={1000}
                required
                rows={4}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="sp-alert sp-error">
              {error}
            </p>
          )}
          <div className="sp-actions">
            <button className="sp-button sp-primary" disabled={busy}>
              {busy
                ? "Saving…"
                : approve
                  ? "✓ Approve and return signed copy"
                  : "✕ Reject and send reason"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
