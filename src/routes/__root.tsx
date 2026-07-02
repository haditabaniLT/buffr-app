import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Buffr — AI-Powered Transaction Monitoring" },
      { name: "description", content: "Buffr helps parents protect students from risky financial activity with AI-powered transaction monitoring and real-time alerts." },
      { property: "og:title", content: "Buffr — AI-Powered Transaction Monitoring" },
      { name: "twitter:title", content: "Buffr — AI-Powered Transaction Monitoring" },
      { property: "og:description", content: "Buffr helps parents protect students from risky financial activity with AI-powered transaction monitoring and real-time alerts." },
      { name: "twitter:description", content: "Buffr helps parents protect students from risky financial activity with AI-powered transaction monitoring and real-time alerts." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b1ee5741-f5e7-4c36-95ab-8cd8f3312ed9/id-preview-d23790d6--7835f344-b68b-4c88-8e26-3ad52a85caf8.lovable.app-1777032830241.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b1ee5741-f5e7-4c36-95ab-8cd8f3312ed9/id-preview-d23790d6--7835f344-b68b-4c88-8e26-3ad52a85caf8.lovable.app-1777032830241.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          <StoreProvider>
            {children}
            <Toaster />
          </StoreProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
