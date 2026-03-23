import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — BSVibes",
  description: "Frequently asked questions about on-chain comments, privacy, and safety.",
};

interface FaqItem {
  q: string;
  a: string[];
}

interface FaqSection {
  title: string;
  items: FaqItem[];
}

const sections: FaqSection[] = [
  {
    title: "Understanding the Basics",
    items: [
      {
        q: 'What does "on-chain" mean?',
        a: [
          "When you post a comment, the app sends it to the Bitcoin SV (BSV) blockchain network. The blockchain is a public database maintained by thousands of computers around the world. No single person or company controls it.",
          "Your comment is stored as a small piece of data inside a transaction. Once it is included in a block (usually within seconds to minutes), it exists in that shared database permanently.",
        ],
      },
      {
        q: 'What does "permanent" mean in practice?',
        a: [
          "It means no one can delete it. Not us. Not the blockchain operators. Not a court order. Not a government.",
          "We can hide a comment from this app\u2019s interface so it no longer appears in the feed. But the raw data remains in the blockchain, which is public. Anyone can look it up using a block explorer.",
          "Before you post anything, ask yourself: would I be comfortable if this text appeared on a public website forever? If the answer is no, do not post it.",
        ],
      },
      {
        q: "Is there any way to delete something after posting?",
        a: [
          "No. There is no deletion after a comment reaches the blockchain.",
          "We can delist a comment \u2014 which means it disappears from this app\u2019s feed. But the blockchain data is not affected. It remains visible in block explorers and any other tool that reads BSV transactions.",
        ],
      },
    ],
  },
  {
    title: "Privacy and Personal Information",
    items: [
      {
        q: "What happens if I post personal information?",
        a: [
          "It becomes permanently public on the blockchain. Any personal information you include \u2014 your real name, phone number, home address, email \u2014 will be readable by anyone, forever. We cannot remove it.",
          "This applies to information about other people too. Posting someone else\u2019s personal details without their consent violates our Terms of Service.",
        ],
      },
      {
        q: "What information does the app store about me?",
        a: [
          "Two things: (1) Your comment and display name, written to the BSV blockchain. These are public and permanent. (2) A hashed IP address used for abuse detection and rate limits. We do not store your actual IP address. These hashes are automatically deleted.",
          "We do not use cookies, analytics trackers, advertising pixels, or any third-party tracking.",
        ],
      },
      {
        q: "Can I request deletion of data about me?",
        a: [
          "For off-chain data (hashed IP address): yes. Contact privacy@bsvibes.com.",
          "For on-chain data (your comment and display name): we cannot delete this. We can delist the comment from this app\u2019s interface upon request.",
        ],
      },
    ],
  },
  {
    title: "Safety and Harassment",
    items: [
      {
        q: "What can the app do if someone is harassing me?",
        a: [
          "We can delist a comment that harasses you, which removes it from this app\u2019s feed. Email abuse@bsvibes.com with the transaction ID (txid) shown on the comment and a brief description.",
          "If you are being seriously threatened, contact law enforcement. We will cooperate with law enforcement requests for information.",
        ],
      },
      {
        q: "What content is blocked before it reaches the blockchain?",
        a: [
          "Every comment is screened before broadcast. Blocked categories include: child sexual abuse material (CSAM), credible threats of violence, hate speech, harassment, graphic violence, content subject to court orders or valid DMCA takedowns, and spam.",
          "If your comment is blocked, nothing reaches the blockchain.",
        ],
      },
      {
        q: "How do I report a comment?",
        a: [
          "Email abuse@bsvibes.com with the transaction ID (txid), the reason for the report, and any supporting context.",
          "For DMCA takedown requests: dmca@bsvibes.com. For law enforcement: legal@bsvibes.com.",
        ],
      },
    ],
  },
  {
    title: "Fees and the Free Model",
    items: [
      {
        q: "Will posting always be free?",
        a: [
          "Not necessarily. The app currently pays all BSV transaction fees on your behalf. This is voluntary and can change.",
          "If fees are introduced, comments you have already posted are not affected \u2014 they are already on the blockchain.",
        ],
      },
      {
        q: "Could the app shut down?",
        a: [
          "Yes. If the app shuts down, your comments remain on the BSV blockchain permanently. Anyone can build a tool to read them. The blockchain does not depend on this app existing.",
        ],
      },
    ],
  },
  {
    title: "Technical Questions",
    items: [
      {
        q: "What is OP_RETURN?",
        a: [
          "OP_RETURN is a field in a BSV transaction that can carry arbitrary data. Your comment text is encoded into this field when the transaction is built.",
        ],
      },
      {
        q: "Can I look up my own comment on the blockchain?",
        a: [
          "Yes. When you post, the app returns a transaction ID (txid). Paste it into any BSV block explorer, such as whatsonchain.com, to see the raw transaction data.",
        ],
      },
      {
        q: "Does posting require an account or wallet?",
        a: [
          "No. You do not need a BSV wallet or account. The app pays the transaction fee from its own wallet. All you need is a display name (optional) and a comment.",
        ],
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-3 pb-6 border-b border-neutral-800/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-neutral-400">
          Plain-language answers. No technical background needed.
        </p>
      </div>

      {sections.map((section) => (
        <div key={section.title} className="space-y-4">
          <h2 className="text-lg font-semibold text-neutral-200">
            {section.title}
          </h2>
          <div className="space-y-5">
            {section.items.map((item) => (
              <details
                key={item.q}
                className="group border border-neutral-800 rounded-xl bg-neutral-950 hover:border-neutral-700/80 transition-colors"
              >
                <summary className="cursor-pointer px-4 py-3.5 text-sm font-medium text-neutral-200 flex items-center justify-between gap-3 select-none">
                  {item.q}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="flex-shrink-0 text-neutral-600 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 4.5L6 7.5L9 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="px-4 pb-4 space-y-2.5">
                  {item.a.map((paragraph, i) => (
                    <p
                      key={i}
                      className="text-sm text-neutral-400 leading-relaxed"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      ))}

      <div className="border-t border-neutral-800/60 pt-6 space-y-2">
        <h2 className="text-lg font-semibold text-neutral-200">Contact</h2>
        <div className="text-sm text-neutral-400 space-y-1">
          <p>
            Privacy and data requests:{" "}
            <a href="mailto:privacy@bsvibes.com" className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100 transition-colors">
              privacy@bsvibes.com
            </a>
          </p>
          <p>
            Report harmful content:{" "}
            <a href="mailto:abuse@bsvibes.com" className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100 transition-colors">
              abuse@bsvibes.com
            </a>
          </p>
          <p>
            DMCA takedown requests:{" "}
            <a href="mailto:dmca@bsvibes.com" className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100 transition-colors">
              dmca@bsvibes.com
            </a>
          </p>
          <p>
            Law enforcement:{" "}
            <a href="mailto:legal@bsvibes.com" className="text-neutral-300 underline underline-offset-2 hover:text-neutral-100 transition-colors">
              legal@bsvibes.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
