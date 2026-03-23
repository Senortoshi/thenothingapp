import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — BSVibes",
};

export default function PrivacyPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-3 pb-6 border-b border-neutral-800/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
          Privacy Policy
        </h1>
        <p className="text-xs text-neutral-500">
          Last updated: March 15, 2026
        </p>
      </div>

      <div className="space-y-8 text-sm text-neutral-300 leading-relaxed">
        {/* 1. Data We Collect */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            1. Data We Collect
          </h2>
          <p>We collect the following data when you use the Service:</p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              <strong className="text-neutral-300">Comment text and display name:</strong>{" "}
              Written to the BSV blockchain as an{" "}
              <code className="text-xs bg-neutral-800 px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] text-neutral-300">
                OP_RETURN
              </code>{" "}
              output. This data is <strong className="text-neutral-200">permanent and publicly visible</strong> on the
              blockchain.
            </li>
            <li>
              <strong className="text-neutral-300">Hashed IP addresses:</strong>{" "}
              We store a one-way hash of your IP address for rate-limiting and
              abuse prevention purposes. These hashes are held temporarily in
              our rate-limiting service (not in our primary database) and{" "}
              <strong className="text-neutral-200">expire automatically
              within hours</strong> based on the rate-limit window duration.
              No IP data is retained long-term.
            </li>
          </ul>
          <p className="text-neutral-400">
            We do <strong className="text-neutral-300">not</strong> use cookies, analytics trackers,
            advertising pixels, or any third-party tracking technologies.
          </p>
        </section>

        {/* 2. Blockchain Permanence */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            2. Blockchain Permanence Disclosure
          </h2>
          <p>
            Comment text and display names are written directly to the BSV
            mainnet blockchain. Once confirmed in a block, this data{" "}
            <strong className="text-neutral-200">cannot be deleted, modified, or erased</strong> by anyone,
            including the operators of this Service.
          </p>
          <p>
            Content may be delisted (hidden) from this app&apos;s interface, but
            it remains permanently accessible through block explorers and other
            blockchain tools. We cannot honor deletion requests for data that
            exists on the blockchain.
          </p>
        </section>

        {/* 3. Data Sharing */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            3. Data Sharing
          </h2>
          <p>We share data in the following limited circumstances:</p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              <strong className="text-neutral-300">Moderation API:</strong>{" "}
              Submitted comment text may be sent to a content-screening service
              for moderation purposes before being broadcast to the blockchain.
            </li>
            <li>
              <strong className="text-neutral-300">BSV network:</strong>{" "}
              Comments are broadcast to the BSV blockchain network, which is
              public by nature.
            </li>
          </ul>
          <p className="text-neutral-400">
            We do <strong className="text-neutral-300">not</strong> sell, rent, or share your data with
            marketing platforms, analytics providers, or any other third parties
            beyond those described above.
          </p>
        </section>

        {/* 4. Your Rights */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            4. Your Rights
          </h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              <strong className="text-neutral-300">Access:</strong> Request a
              copy of the data we hold about you (off-chain data such as
              rate-limit records)
            </li>
            <li>
              <strong className="text-neutral-300">Off-chain deletion:</strong>{" "}
              Request deletion of off-chain data. Hashed IP addresses used for
              rate limiting expire automatically within hours and are not stored
              in our primary database.
            </li>
            <li>
              <strong className="text-neutral-300">On-chain limitation:</strong>{" "}
              Request delisting of your content from this app&apos;s interface.
              Note that the underlying blockchain data cannot be deleted.
            </li>
          </ul>
        </section>

        {/* 5. GDPR */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            5. GDPR &amp; Right to Erasure
          </h2>
          <p>
            For users in the European Economic Area (EEA), the UK, and other
            jurisdictions with similar data protection laws:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-400 pl-2">
            <li>
              <strong className="text-neutral-300">Off-chain data:</strong> We
              will honor erasure requests for off-chain data in accordance with
              GDPR Article 17. Hashed IP addresses are stored only in our
              rate-limiting service with short-lived TTLs (hours, not days) and
              are never persisted in our primary database.
            </li>
            <li>
              <strong className="text-neutral-300">On-chain data:</strong> Due
              to the technical architecture of blockchain technology, it is{" "}
              <strong className="text-neutral-200">technically impossible</strong> to delete data that has been
              confirmed on the BSV blockchain. We acknowledge this limitation
              and will delist content from our interface upon valid request.
            </li>
          </ul>
          <p className="text-neutral-400">
            By using this Service, you acknowledge that you have been informed
            of this technical limitation before submitting any content.
          </p>
        </section>

        {/* 6. Children */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            6. Children&apos;s Privacy
          </h2>
          <p>
            This Service is not intended for users under the age of{" "}
            <strong className="text-neutral-200">13</strong>. We do not knowingly collect personal information
            from children under 13. If you believe a child under 13 has used
            this Service, please contact us so we can take appropriate action.
          </p>
        </section>

        {/* 7. Contact */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            7. Contact
          </h2>
          <p>
            For privacy-related inquiries, data access requests, or delisting
            requests, please contact us at:{" "}
            <span className="text-neutral-200 font-medium">
              privacy@bsvibes.com
            </span>
          </p>
        </section>

        {/* 8. Changes */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-100">
            8. Changes to This Policy
          </h2>
          <p>
            We may update this Privacy Policy from time to time. We will
            indicate the date of the last update at the top of this page.
            Continued use of the Service after changes constitutes acceptance of
            the revised policy.
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
