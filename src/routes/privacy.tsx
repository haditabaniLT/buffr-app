import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Buffr" },
      { name: "description", content: "Buffr Privacy Policy — how we collect, use, and protect your data." },
    ],
  }),
});

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-2">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={28} />
          <span className="font-semibold tracking-tight">Buffr</span>
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16 prose prose-sm dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">Last updated: May 2026</p>

        <h2>1. Introduction</h2>
        <p>
          Buffr ("we," "our," or "us") operates a financial-awareness platform that helps parents
          monitor their teen's spending activity for high-risk behavioral patterns. This Privacy
          Policy explains how we collect, use, disclose, and protect your personal information.
        </p>

        <h2>2. Information We Collect</h2>
        <ul>
          <li><strong>Account information:</strong> name, email address, and phone number provided at sign-up.</li>
          <li><strong>Financial data:</strong> transaction metadata (merchant name, amount, date, category) retrieved via the Plaid API from linked bank accounts. We do not store full account numbers or credentials.</li>
          <li><strong>Usage data:</strong> log data, IP addresses, and browser/device information collected automatically.</li>
        </ul>

        <h2>3. SMS / Text Messaging</h2>
        <p>
          When you register for a Buffr parent account and provide a phone number, you consent to
          receive text message alerts from Buffr when potentially risky financial activity is detected
          on a linked account. These messages are sent using Twilio on the A2P 10DLC program.
        </p>
        <ul>
          <li><strong>Message frequency:</strong> up to 10 messages per month, only when flagged activity occurs.</li>
          <li><strong>Message and data rates</strong> from your mobile carrier may apply.</li>
          <li>
            <strong>Opt-out:</strong> reply <strong>STOP</strong> to any Buffr SMS to immediately
            unsubscribe. You will receive one final confirmation message and no further alerts.
          </li>
          <li>
            <strong>Re-subscribe:</strong> reply <strong>START</strong> or <strong>YES</strong> to
            opt back in after opting out.
          </li>
          <li>
            <strong>Help:</strong> reply <strong>HELP</strong> to any Buffr SMS or email{" "}
            <a href="mailto:support@usebuffr.com">support@usebuffr.com</a>.
          </li>
          <li>
            Your phone number is used exclusively for Buffr alert messages. We do not sell or share
            your phone number with third parties for marketing purposes.
          </li>
        </ul>

        <h2>4. How We Use Your Information</h2>
        <ul>
          <li>To operate the Buffr platform and provide transaction monitoring.</li>
          <li>To send SMS alerts when flagged financial activity is detected.</li>
          <li>To improve our risk-detection models and service quality.</li>
          <li>To comply with legal obligations.</li>
        </ul>

        <h2>5. Data Sharing</h2>
        <p>
          We share data only as necessary to operate the service:
        </p>
        <ul>
          <li><strong>Plaid:</strong> to retrieve transaction data from linked bank accounts.</li>
          <li><strong>Twilio:</strong> to send SMS alerts.</li>
          <li><strong>Supabase:</strong> our database and authentication provider.</li>
          <li><strong>OpenAI:</strong> transaction metadata (merchant name, amount) may be sent to OpenAI's API for risk analysis. No personally identifiable account or payment data is included.</li>
        </ul>
        <p>We do not sell your personal information.</p>

        <h2>6. Data Retention</h2>
        <p>
          We retain account data for as long as your account is active. Flagged transaction records
          are retained for 24 months. You may request deletion of your account by contacting{" "}
          <a href="mailto:support@usebuffr.com">support@usebuffr.com</a>.
        </p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard security measures including TLS encryption in transit, encrypted
          storage at rest, and row-level security policies on our database. Bank credentials are
          never stored — access tokens are managed by Plaid.
        </p>

        <h2>8. Children's Privacy</h2>
        <p>
          Buffr accounts for minors (under 18) are created and managed by a parent or guardian.
          We do not knowingly collect personal data directly from children under 13.
        </p>

        <h2>9. Your Rights</h2>
        <p>
          Depending on your location you may have rights to access, correct, or delete your
          personal data. Contact us at <a href="mailto:support@usebuffr.com">support@usebuffr.com</a> to
          exercise these rights.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy periodically. The "last updated" date at the top of
          this page will reflect the most recent revision. Continued use of Buffr after changes
          constitutes acceptance of the updated policy.
        </p>

        <h2>11. Contact Us</h2>
        <p>
          Buffr<br />
          Email: <a href="mailto:support@usebuffr.com">support@usebuffr.com</a><br />
          Website: <a href="https://usebuffr.com">usebuffr.com</a>
        </p>
      </main>

      <footer className="max-w-3xl mx-auto px-6 pb-8 text-xs text-muted-foreground flex gap-4">
        <Link to="/" className="hover:underline">Home</Link>
        <Link to="/terms" className="hover:underline">Terms of Service</Link>
      </footer>
    </div>
  );
}
