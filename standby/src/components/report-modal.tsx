"use client";

import { useState, useRef, useCallback, useEffect, type FormEvent } from "react";

const REPORT_REASONS = [
  "My personal information is in this post",
  "Harassment or threats",
  "Illegal content",
  "Spam",
  "Other",
] as const;

type ReportReason = (typeof REPORT_REASONS)[number];
type ModalState = "idle" | "submitting" | "success" | "error";

interface ReportModalProps {
  open: boolean;
  txid: string;
  onClose: () => void;
}

export function ReportModal({ open, txid, onClose }: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [state, setState] = useState<ModalState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const firstFocusableRef = useRef<HTMLSelectElement>(null);

  const detailsLeft = 500 - details.length;
  const isOverLimit = detailsLeft < 0;
  const canSubmit =
    reason !== "" && !isOverLimit && state !== "submitting" && state !== "success";

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setReason("");
      setDetails("");
      setContactEmail("");
      setState("idle");
      setErrorMessage("");
    }
  }, [open]);

  // Focus trap + scroll lock
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [open, onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      setTimeout(() => firstFocusableRef.current?.focus(), 10);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txid,
          reason,
          details: details.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error ?? "Failed to submit report. Please try again.");
        setState("error");
        return;
      }

      setState("success");
    } catch {
      setErrorMessage("Network error — please try again.");
      setState("error");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      aria-describedby="report-modal-desc"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ animation: "modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Top accent stripe */}
        <div className="h-0.5 w-full bg-neutral-700" />

        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {/* Flag icon */}
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-950/40 border border-red-800/40 flex items-center justify-center">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="text-red-400"
                >
                  <path
                    d="M2.5 1.5V12.5M2.5 1.5H10.5L8.5 5L10.5 8.5H2.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2
                id="report-modal-title"
                className="text-base font-semibold text-neutral-100"
              >
                Report content
              </h2>
            </div>

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:ring-offset-2 focus:ring-offset-neutral-900"
              aria-label="Close report modal"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M1 1L11 11M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Blockchain notice */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-neutral-800/50 border border-neutral-700/60 rounded-lg">
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              className="flex-shrink-0 mt-0.5 text-neutral-500"
            >
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 6V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7" cy="4" r="0.75" fill="currentColor" />
            </svg>
            <p
              id="report-modal-desc"
              className="text-xs text-neutral-500 leading-relaxed"
            >
              Reported content can be hidden from this app but cannot be removed
              from the blockchain.
            </p>
          </div>

          {state === "success" ? (
            /* Success state */
            <div className="py-4 space-y-3 text-center">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-full border border-emerald-800/50 bg-emerald-950/40 flex items-center justify-center">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                    className="text-emerald-400"
                  >
                    <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M6.5 10L9 12.5L13.5 7.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-200">
                  Report submitted.
                </p>
                <p className="text-sm text-neutral-500 mt-1">
                  We will review this content.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 px-5 py-2 text-sm font-medium text-neutral-400 border border-neutral-700 rounded-lg hover:text-neutral-200 hover:border-neutral-600 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:ring-offset-2 focus:ring-offset-neutral-900"
              >
                Close
              </button>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Reason selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="report-reason"
                  className="block text-xs font-medium text-neutral-400"
                >
                  Reason <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select
                  ref={firstFocusableRef}
                  id="report-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReportReason | "")}
                  required
                  disabled={state === "submitting"}
                  className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 disabled:opacity-50 transition-all appearance-none cursor-pointer min-h-[44px]"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2 4L6 8L10 4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 12px center",
                    paddingRight: "36px",
                  }}
                >
                  <option value="" disabled>
                    Select a reason…
                  </option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Details textarea */}
              <div className="space-y-1.5">
                <label
                  htmlFor="report-details"
                  className="block text-xs font-medium text-neutral-400"
                >
                  Additional details{" "}
                  <span className="text-neutral-600 font-normal">(optional)</span>
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Describe the issue…"
                  rows={3}
                  maxLength={550}
                  disabled={state === "submitting"}
                  className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 disabled:opacity-50 resize-none transition-all leading-relaxed"
                  style={{ minHeight: "80px" }}
                />
                <div className="flex justify-end">
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      isOverLimit
                        ? "text-red-400"
                        : detailsLeft <= 50
                        ? "text-amber-400"
                        : "text-neutral-600"
                    }`}
                  >
                    {isOverLimit
                      ? `${Math.abs(detailsLeft)} over limit`
                      : `${detailsLeft} remaining`}
                  </span>
                </div>
              </div>

              {/* Contact email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="report-email"
                  className="block text-xs font-medium text-neutral-400"
                >
                  Contact email{" "}
                  <span className="text-neutral-600 font-normal">
                    (optional — so we can update you)
                  </span>
                </label>
                <input
                  id="report-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={state === "submitting"}
                  autoComplete="email"
                  className="w-full bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500 focus:border-neutral-500 disabled:opacity-50 transition-all min-h-[44px]"
                />
              </div>

              {/* Error state */}
              {state === "error" && (
                <div
                  role="alert"
                  className="text-sm text-red-300 bg-red-950/40 border border-red-800/50 rounded-lg px-3.5 py-2.5 flex items-start gap-2"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="flex-shrink-0 mt-0.5 text-red-400"
                    aria-hidden="true"
                  >
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M7 4.5V7.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="7" cy="9.5" r="0.75" fill="currentColor" />
                  </svg>
                  {errorMessage}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={state === "submitting"}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-neutral-400 border border-neutral-700 rounded-lg hover:text-neutral-200 hover:border-neutral-600 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:opacity-50 min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  aria-busy={state === "submitting"}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-neutral-900 bg-neutral-100 rounded-lg hover:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[44px]"
                >
                  {state === "submitting" ? (
                    <>
                      <span
                        className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-neutral-800 rounded-full animate-spin"
                        aria-hidden="true"
                      />
                      Submitting…
                    </>
                  ) : (
                    "Submit report"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
