import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/terms")({
  component: TermsOfService,
  head: () => ({
    meta: [
      { title: "Terms of Service — Buffr" },
      { name: "description", content: "Buffr Terms of Service." },
    ],
  }),
});

function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-2">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={28} />
          <span className="font-semibold tracking-tight">Buffr</span>
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16 prose prose-sm dark:prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground text-sm">Last updated: May 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating a Buffr account or using the Buffr platform, you agree to these Terms of
          Service ("Terms"). If you do not agree, do not use the service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Buffr is a financial-awareness platform that connects to bank accounts via Plaid, monitors
          transaction activity for high-risk behavioral patterns (including gambling, payday lending,
          cryptocurrency, and similar categories), and sends SMS alerts to parent/guardian accounts
          when such activity is detected. Buffr is an awareness and notification tool — it does not
          restrict transactions or provide financial advice.
        </p>

        <h2>3. Eligibility</h2>
        <ul>
          <li>Parent/Advocate accounts: must be 18 or older.</li>
          <li>Child accounts for minors are created by and remain under the supervision of their parent/guardian.</li>
          <li>Adult child accounts (18+) require the account holder's own consent.</li>
        </ul>

        <h2>4. SMS Communications</h2>
        <p>
          By providing a phone number and checking the consent box at sign-up, you expressly consent
          to receive automated text messages from Buffr containing transaction alerts. You understand that:
        </p>
        <ul>
          <li>Message and data rates from your carrier may apply.</li>
          <li>Message frequency is up to 10 messages per month, triggered by flagged activity.</li>
          <li>You may opt out at any time by replying <strong>STOP</strong> to any Buffr message.</li>
          <li>Consent to receive SMS is not a condition of using the Buffr platform.</li>
          <li>
            For help, reply <strong>HELP</strong> or contact{" "}
            <a href="mailto:support@buffr.app">support@buffr.app</a>.
          </li>
        </ul>

        <h2>5. Bank Account Linking</h2>
        <p>
          Buffr uses Plaid to securely access read-only transaction data from linked bank accounts.
          You authorise Buffr to retrieve this data on your behalf. Buffr does not store bank
          credentials, account numbers, or routing numbers. You may remove linked accounts at any
          time from the Bank Accounts settings page.
        </p>

        <h2>6. Prohibited Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use Buffr for any unlawful purpose.</li>
          <li>Attempt to access accounts you are not authorised to monitor.</li>
          <li>Reverse engineer, scrape, or circumvent Buffr's systems.</li>
          <li>Use Buffr to harass or monitor individuals without their knowledge where legally required.</li>
        </ul>

        <h2>7. Disclaimer of Warranties</h2>
        <p>
          Buffr is provided "as is" without warranties of any kind. Transaction monitoring may not
          detect all risky activity and should not be relied upon as the sole means of financial
          supervision. Buffr is not a financial institution or credit reporting agency.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Buffr's liability for any claim arising from these
          Terms or your use of the service is limited to the amount you paid for the service in the
          12 months preceding the claim.
        </p>

        <h2>9. Governing Law</h2>
        <p>These Terms are governed by the laws of the United States.</p>

        <h2>10. Changes</h2>
        <p>
          We may update these Terms. Continued use of Buffr after changes are posted constitutes
          acceptance of the revised Terms.
        </p>

        <h2>11. Contact</h2>
        <p>
          Buffr<br />
          Email: <a href="mailto:support@buffr.app">support@buffr.app</a>
        </p>
      </main>

      <footer className="max-w-3xl mx-auto px-6 pb-8 text-xs text-muted-foreground flex gap-4">
        <Link to="/" className="hover:underline">Home</Link>
        <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
