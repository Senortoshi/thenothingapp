"use client";

import { useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "bsvibes:permanence-ack";

export function getPermanenceAck(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "true";
}

export function setPermanenceAck(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, "true");
}

interface PermanenceModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PermanenceModal({
  open,
  onCancel,
  onConfirm,
}: PermanenceModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
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
    [open, onCancel]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      // Focus the cancel button by default (safer default)
      setTimeout(() => cancelBtnRef.current?.focus(), 10);
      // Prevent background scroll
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permanence-title"
      aria-describedby="permanence-body"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ animation: "modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Warning stripe */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600" />

        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="text-amber-500"
              >
                <path
                  d="M10 2L18 16H2L10 2Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 8V11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
              </svg>
            </div>
            <h2
              id="permanence-title"
              className="text-base font-semibold text-neutral-100 leading-snug"
            >
              This is permanent.
            </h2>
          </div>

          {/* Body */}
          <div
            id="permanence-body"
            className="text-sm text-neutral-300 leading-relaxed space-y-3 pl-8"
          >
            <p>
              Your comment will be written to the Bitcoin SV blockchain. Once
              submitted, it cannot be deleted, edited, or removed by anyone
              &mdash; including us.
            </p>
            <p>
              This is not a design choice. It is a property of blockchain
              technology. Your words will exist on the public ledger
              permanently.
            </p>
            <p className="text-neutral-400">
              Do not include personal information you would not want permanently
              public (real name, address, phone number, etc.).
            </p>
            <p className="text-xs text-neutral-500 italic">
              Content may be hidden from this app&apos;s interface, but it
              remains permanently accessible on the blockchain through block
              explorers.
            </p>

            <div className="pt-1 border-t border-neutral-800">
              <p className="text-xs text-neutral-500 mb-2">
                By clicking &ldquo;Post permanently,&rdquo; you confirm that:
              </p>
              <ul className="text-xs text-neutral-400 space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-neutral-600 mt-0.5">—</span>
                  <span>
                    You understand this comment is permanent and irrevocable
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-neutral-600 mt-0.5">—</span>
                  <span>Your comment does not contain illegal content</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-neutral-600 mt-0.5">—</span>
                  <span>You are at least 13 years old</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 pl-8">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-neutral-100 bg-neutral-800 border border-neutral-600 rounded-lg hover:bg-neutral-700 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:ring-offset-2 focus:ring-offset-neutral-900"
            >
              Cancel
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-amber-950 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-neutral-900"
            >
              Post permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
