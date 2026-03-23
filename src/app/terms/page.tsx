import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — BSVibes",
};

export default function TermsPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-3 pb-6 border-b border-neutral-800/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
          Terms of Service
        </h1>
        <p className="text-xs text-neutral-500">
          Last updated: March 15, 2026
        </p>
      </div>

      <div className="space-y-8 text-sm text-neutral-300 leading-relaxed">
        {/* 1. Service Description */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            1. Service Description
          </h2>
          <p>
            The BSVibes (&ldquo;Service&rdquo;) is a public comment box that
            writes user-submitted messages to the Bitcoin SV (BSV) mainnet
            blockchain as{" "}
            <code className="text-xs bg-neutral-800 px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] text-neutral-300">
              OP_RETURN
            </code>{" "}
            outputs. Each comment is broadcast as a transaction on the BSV
            mainnet and becomes a permanent part of the public blockchain.
          </p>
        </section>

        {/* 2. Permanence of Content */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            2. Permanence of Content
          </h2>
          <p>
            Content submitted through this Service is written to the BSV
            blockchain. Once a transaction is confirmed, <strong className="text-neutral-200">it cannot be deleted,
            edited, or removed by anyone</strong>, including the operators of this
            Service. This is an inherent property of blockchain technology, not a
            design choice.
          </p>
          <p>
            Content may be delisted (hidden) from this app&apos;s interface, but
            it remains permanently accessible on the blockchain through block
            explorers and other tools. By using this Service you acknowledge and
            accept this permanence.
          </p>
        </section>

        {/* 3. User Conduct */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            3. User Conduct
          </h2>
          <p>You agree not to use this Service to post content that:</p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              Is illegal under applicable law, including but not limited to
              child sexual abuse material (CSAM)
            </li>
            <li>
              Constitutes harassment, threats, or incitement of violence against
              any person or group
            </li>
            <li>
              Contains personal or private information of others without their
              consent (doxxing)
            </li>
            <li>Infringes on the intellectual property rights of others</li>
            <li>Contains malware, phishing links, or other malicious content</li>
          </ul>
          <p className="text-neutral-400">
            Violation of these rules may result in your content being delisted
            from the app&apos;s interface and your access being restricted.
          </p>
        </section>

        {/* 4. Fee Sponsorship */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            4. Fee Sponsorship
          </h2>
          <p>
            The Service currently sponsors all BSV transaction fees on behalf of
            users at no charge. This sponsorship is provided voluntarily and{" "}
            <strong className="text-neutral-200">may be revoked, limited, or modified in the future</strong>.
            We reserve the right to introduce fees or usage limits for new
            submissions.
          </p>
          <p>
            If we introduce fees for new submissions, we will post a notice on
            the Service homepage at least{" "}
            <strong className="text-neutral-200">14 days before the change takes effect</strong>.
            Content you have already posted to the blockchain is not subject to
            future fees — blockchain transactions, once confirmed, carry no
            ongoing cost. A fee change affects only new submissions made after
            the effective date.
          </p>
          <p className="text-neutral-400">
            If you object to a fee change, your remedy is to stop using the
            Service before the effective date. You cannot request removal of
            content already posted to the blockchain on the basis of a
            subsequent fee change.
          </p>
        </section>

        {/* 5. Content Moderation */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            5. Content Moderation
          </h2>
          <p>
            We employ content moderation measures including:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              <strong className="text-neutral-300">Pre-broadcast scanning:</strong> submitted
              content may be screened before it is broadcast to the blockchain
            </li>
            <li>
              <strong className="text-neutral-300">Post-broadcast delisting:</strong> content
              that violates these Terms may be hidden from the app&apos;s
              interface after broadcast
            </li>
          </ul>
          <p className="text-neutral-400">
            Delisting removes content from this app only. It does not remove
            content from the BSV blockchain, which remains publicly accessible
            through block explorers.
          </p>
        </section>

        {/* 6. Limitation of Liability */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            6. Limitation of Liability
          </h2>
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
            AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
            TO THE FULLEST EXTENT PERMITTED BY LAW, THE OPERATORS OF THIS
            SERVICE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE
            SERVICE.
          </p>
          <p>
            We are not responsible for the permanence of content on the
            blockchain, the availability of the Service, or any consequences
            arising from content posted by users.
          </p>
        </section>

        {/* 7. Age Requirement */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            7. Age Requirement
          </h2>
          <p>
            You must be at least <strong className="text-neutral-200">13 years of age</strong> to use this Service.
            By using the Service, you represent and warrant that you meet this
            age requirement.
          </p>
        </section>

        {/* 8. Governing Law */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            8. Governing Law
          </h2>
          <p className="text-neutral-400">
            These Terms shall be governed by and construed in accordance with the
            laws of the State of Wyoming, United States. Any disputes arising under these Terms shall
            be subject to the exclusive jurisdiction of the courts of
            the State of Wyoming, United States.
          </p>
        </section>

        {/* 9. Changes to Terms */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            9. Changes to These Terms
          </h2>
          <p>
            We reserve the right to update these Terms at any time. Continued
            use of the Service after changes constitutes acceptance of the
            revised Terms. We will indicate the date of the last update at the
            top of this page.
          </p>
        </section>

        {/* Back link */}
        <div className="pt-4 border-t border-neutral-800/60">
          <a
            href="/"
            className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors underline underline-offset-2"
          >
            &larr; Back to BSVibes
          </a>
        </div>
      </div>
    </div>
  );
}
