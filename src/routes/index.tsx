import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Bell, BarChart3, Lock } from "lucide-react";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Buffr — Real-time financial awareness for parents" },
      { name: "description", content: "Buffr connects to your teen's financial activity, detects gambling-related behavior and other high-risk spending patterns, and gives parents real-time visibility before habits spiral." },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-hero)" }}>
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={32} />
          <span className="font-semibold tracking-tight">Buffr</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
          <Link to="/signup"><Button size="sm">Get started</Button></Link>
        </nav>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 text-center">
        <span className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full bg-accent text-accent-foreground border">
          Real-time financial awareness
        </span>
        <h1 className="mt-5 text-4xl md:text-6xl font-semibold tracking-tight max-w-3xl mx-auto">
          See risky financial behavior{" "}
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>
            before it escalates
          </span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-xl mx-auto">
          Buffr connects to your teen's financial activity, detects gambling-related behavior and other high-risk spending patterns, and gives parents real-time visibility before habits spiral.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Link to="/signup"><Button size="lg">Get visibility</Button></Link>
          <Link to="/login"><Button size="lg" variant="outline">See how it works</Button></Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-4">
        {features.map((f) => (
          <Card key={f.title} className="border bg-card/80 backdrop-blur">
            <CardContent className="p-6">
              <div className="h-10 w-10 rounded-lg grid place-items-center bg-accent text-accent-foreground mb-4">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5">{f.desc}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-6 border-t flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Buffr. All rights reserved.</span>
        <div className="flex gap-4">
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="hover:underline">Terms of Service</Link>
          <a href="mailto:support@usebuffr.com" className="hover:underline">Contact</a>
        </div>
      </footer>
    </div>
  );
}

const features = [
  { icon: Shield, title: "Behavioral risk detection", desc: "Buffr identifies gambling-related activity and emerging spending patterns before they become difficult to recognize." },
  { icon: Bell, title: "Instant parent alerts", desc: "Receive immediate notifications when potentially risky financial behavior is detected." },
  { icon: BarChart3, title: "Shared financial visibility", desc: "Parents and teens receive clear, personalized insights designed to encourage awareness — not control." },
];
