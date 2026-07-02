import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  mockUsers,
  mockAccounts,
  mockTransactions,
  mockMerchants,
  mockSmsLogs,
  mockFAQs,
  type User,
  type BankAccount,
  type Transaction,
  type Merchant,
  type SmsLog,
  type FAQ,
} from "./mock-data";
import { useAuth } from "./auth";

type State = {
  currentUser: User | null;
  users: User[];
  accounts: BankAccount[];
  transactions: Transaction[];
  merchants: Merchant[];
  smsLogs: SmsLog[];
  faqs: FAQ[];
};

type Ctx = State & {
  logout: () => void;
  addMerchant: (m: Omit<Merchant, "id">) => void;
  updateMerchant: (id: string, m: Partial<Merchant>) => void;
  deleteMerchant: (id: string) => void;
  setUserStatus: (id: string, status: User["status"]) => void;
  addFAQ: (f: Omit<FAQ, "id">) => void;
  deleteFAQ: (id: string) => void;
  connectBank: (bankName: string, userId?: string) => void;
  addChild: (data: { name: string; email: string; under18: boolean }) => User;
};

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, profile, role, signOut } = useAuth();
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [accounts, setAccounts] = useState<BankAccount[]>(mockAccounts);
  const [transactions] = useState<Transaction[]>(mockTransactions);
  const [merchants, setMerchants] = useState<Merchant[]>(mockMerchants);
  const [smsLogs] = useState<SmsLog[]>(mockSmsLogs);
  const [faqs, setFaqs] = useState<FAQ[]>(mockFAQs);
  const [extraChildIds, setExtraChildIds] = useState<string[]>([]);

  // Map authenticated Supabase user -> mock User shape so existing pages keep working.
  const currentUser: User | null = useMemo(() => {
    if (!user || !profile || !role) return null;
    const demoBase = mockUsers.find((u) => u.role === role);
    const baseChildIds = role === "parent" ? demoBase?.childIds ?? [] : undefined;
    return {
      id: user.id,
      name: profile.name || user.email?.split("@")[0] || "User",
      email: profile.email || user.email || "",
      role,
      status: "active",
      createdAt: user.created_at ?? new Date().toISOString(),
      childIds: role === "parent" ? [...(baseChildIds ?? []), ...extraChildIds] : undefined,
      parentId: role === "child" ? demoBase?.parentId : (profile.parent_id ?? undefined),
    };
  }, [user, profile, role, extraChildIds]);

  // Ensure the synthesized currentUser exists in the users list for components that look it up.
  useEffect(() => {
    if (!currentUser) return;
    setUsers((prev) => {
      if (prev.some((u) => u.id === currentUser.id)) return prev;
      return [...prev, currentUser];
    });
  }, [currentUser]);

  const value: Ctx = {
    currentUser,
    users,
    accounts,
    transactions,
    merchants,
    smsLogs,
    faqs,
    logout: () => { void signOut(); },
    addMerchant: (m) => setMerchants((p) => [...p, { ...m, id: `m_${Date.now()}` }]),
    updateMerchant: (id, m) => setMerchants((p) => p.map((x) => (x.id === id ? { ...x, ...m } : x))),
    deleteMerchant: (id) => setMerchants((p) => p.filter((x) => x.id !== id)),
    setUserStatus: (id, status) => setUsers((p) => p.map((x) => (x.id === id ? { ...x, status } : x))),
    addFAQ: (f) => setFaqs((p) => [...p, { ...f, id: `f_${Date.now()}` }]),
    deleteFAQ: (id) => setFaqs((p) => p.filter((x) => x.id !== id)),
    connectBank: (bankName, userId) => {
      const targetId = userId
        ?? (currentUser?.role === "child" ? currentUser.id : currentUser?.childIds?.[0]);
      if (!targetId) return;
      setAccounts((p) => [
        ...p,
        {
          id: `acc_${Date.now()}`,
          userId: targetId,
          bankName,
          mask: String(Math.floor(1000 + Math.random() * 9000)),
          type: "checking",
          balance: Math.round(Math.random() * 3000),
        },
      ]);
    },
    addChild: ({ name, email, under18 }) => {
      const id = `u_child_${Date.now()}`;
      const newChild: User = {
        id,
        name,
        email,
        role: "child",
        status: "active",
        createdAt: new Date().toISOString(),
        parentId: currentUser?.id,
        under18,
      };
      setUsers((prev) => [...prev, newChild]);
      setExtraChildIds((prev) => [...prev, id]);
      return newChild;
    },
  };


  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
