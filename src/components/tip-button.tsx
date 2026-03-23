"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

const QRCode = dynamic(
  () => import("react-qr-code").then((m) => m.default),
  { ssr: false, loading: () => <div className="h-40 w-40 bg-neutral-800 animate-pulse rounded" /> }
);

interface TipButtonProps {
  tipAddress: string;
}

export function TipButton({ tipAddress }: TipButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const bitcoinUri = `bitcoin:${tipAddress}?sv`;
  const shortAddr = `${tipAddress.slice(0, 8)}...${tipAddress.slice(-6)}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tipAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = tipAddress;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [tipAddress]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-amber-900/60 bg-amber-950/40 text-amber-500 font-sans font-medium tracking-wide hover:bg-amber-900/40 hover:border-amber-800/60 transition-colors"
        style={{ fontSize: "10px" }}
        aria-label="Tip this commenter with BSV"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5V11.5M5.5 7H8M8 9H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        tip
      </button>

      {/* Tip modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tip this comment"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="relative w-full sm:max-w-sm bg-neutral-900 border border-neutral-700 rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
            style={{ animation: "modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            {/* Amber stripe */}
            <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600" />

            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-100">
                  Tip this comment
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-300 transition-colors"
                  aria-label="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-xl">
                  <QRCode value={bitcoinUri} size={160} />
                </div>
              </div>

              {/* Address + Copy */}
              <div className="flex items-center gap-2 bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2.5">
                <span className="flex-1 text-xs font-mono text-neutral-400 truncate">
                  {shortAddr}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors flex-shrink-0 min-w-[50px] text-right"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              {/* Open in wallet (bitcoin: URI) */}
              <a
                href={bitcoinUri}
                className="block w-full text-center bg-amber-500 text-amber-950 font-semibold text-sm rounded-lg px-4 py-3 hover:bg-amber-400 active:scale-[0.98] transition-all"
              >
                Open in wallet
              </a>

              {/* Disclaimer */}
              <p className="text-xs text-neutral-600 text-center leading-relaxed">
                Tips go directly to the commenter&apos;s wallet.
                <br />
                BSVibes does not touch these funds.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
