import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BSVibes — On-Chain Comments",
  description:
    "Every comment is stored on BSV mainnet via OP_RETURN. Permanent, public, free to post.",
  openGraph: {
    title: "BSVibes",
    description: "Post comments on-chain to BSV mainnet. Forever.",
    type: "website",
  },
};

/**
 * Inline script to apply the correct theme class before first paint.
 * Prevents a flash of wrong theme on load. Must be render-blocking.
 */
const themeScript = `
(function() {
  document.documentElement.classList.add('dark');
  document.documentElement.style.backgroundColor = '#0a0a0a';
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flash theme detection — render-blocking is intentional */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-[family-name:var(--font-sans)]`}>
        {/* Sticky header */}
        <header className="border-b border-neutral-800/60 sticky top-0 z-40 bg-neutral-950/90 backdrop-blur-md">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            {/* Wordmark */}
            <div className="flex items-center gap-2.5">
              <span
                className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
                aria-hidden="true"
              />
              <span className="font-semibold text-sm tracking-tight text-neutral-100">
                <span className="text-amber-400">BS</span>Vibes
              </span>
              <span className="hidden sm:inline text-xs text-neutral-700 font-[family-name:var(--font-mono)] border border-neutral-800 px-1.5 py-0.5 rounded-md">
                mainnet
              </span>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-700 font-[family-name:var(--font-mono)] hidden sm:inline">
                BSV
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="max-w-2xl mx-auto px-4 sm:px-6 py-8 border-t border-neutral-800/60 mt-4">
          <p className="text-xs text-neutral-700 text-center">
            <span className="font-semibold text-neutral-600">BSVibes</span>
            {" "}&middot;{" "}
            <a
              href="/faq"
              className="hover:text-neutral-500 transition-colors underline underline-offset-2"
            >
              FAQ
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
