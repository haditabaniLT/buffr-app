import { Link, useRouter } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";

const navByRole = {
  parent: [
    { to: "/parent", label: "Dashboard" },
    { to: "/parent/flagged", label: "Flagged Transactions" },
    { to: "/parent/accounts", label: "Bank Accounts" },
    { to: "/parent/child", label: "Child" },
    { to: "/parent/simulate", label: "Simulate" },
    { to: "/parent/settings", label: "Settings" },
  ],
  child: [
    { to: "/student", label: "Dashboard" },
    { to: "/student/accounts", label: "Bank Accounts" },
    { to: "/student/settings", label: "Settings" },
  ],
  admin: [
    { to: "/admin", label: "Overview" },
    { to: "/admin/users", label: "Users" },
    { to: "/admin/merchants", label: "Flagged Merchants" },
    { to: "/admin/monitoring", label: "Monitoring" },
    { to: "/admin/sms", label: "SMS Logs" },
    { to: "/admin/reports", label: "Reports" },
    { to: "/admin/content", label: "Content" },
  ],
} as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentUser, logout } = useStore();
  const router = useRouter();
  if (!currentUser) return <>{children}</>;
  const items = navByRole[currentUser.role];

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground hidden md:flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2 border-b">
          <Logo size={32} />
          <span className="font-semibold tracking-tight flex-1">Buffr</span>
          {currentUser.role === "parent" && <NotificationBell />}
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              className="block px-3 py-2 rounded-md text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              activeProps={{ className: "block px-3 py-2 rounded-md text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
              activeOptions={{ exact: it.to === "/parent" || it.to === "/student" || it.to === "/admin" }}
            >
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t">
          <div className="px-3 py-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{currentUser.name}</div>
            <div className="capitalize">{currentUser.role}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              logout();
              router.navigate({ to: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="md:hidden border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-semibold">Buffr</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { logout(); router.navigate({ to: "/" }); }}>Sign out</Button>
        </header>
        <div className="p-6 md:p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
