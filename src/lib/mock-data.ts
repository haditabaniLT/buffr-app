// Mock data layer for Buffr — no backend, in-memory + localStorage seed.

export type Role = "parent" | "child" | "admin";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "blocked" | "suspended";
  createdAt: string;
  parentId?: string; // for students
  childIds?: string[]; // for parents
  under18?: boolean;
};

export type BankAccount = {
  id: string;
  userId: string;
  bankName: string;
  mask: string;
  type: "checking" | "savings" | "credit";
  balance: number;
};

export type FlagCategory = "gambling" | "payday_loan" | "crypto" | "high_risk";

export type Merchant = {
  id: string;
  name: string;
  category: FlagCategory;
  riskLevel: "low" | "medium" | "high";
};

export type Transaction = {
  id: string;
  accountId: string;
  userId: string; // owning student/parent
  ownerName?: string; // display name of who made the transaction
  merchantName: string;
  category: string;
  amount: number;
  date: string;
  isFlagged: boolean;
  flagReason?: string;
  riskScore?: number;
};

export type SmsLog = {
  id: string;
  parentId: string;
  transactionId: string;
  phone: string;
  message: string;
  status: "delivered" | "pending" | "failed";
  sentAt: string;
};

export type FAQ = { id: string; question: string; answer: string };

// ── Adapter: convert a real DB transaction row → Transaction shape ──────────
// Keeps existing TransactionsTable / dashboard components working unchanged.
import type { TxRow } from "./transactions-server";

export function dbTxToMock(t: TxRow): Transaction {
  return {
    id:           t.id,
    accountId:    t.bank_account_id ?? t.plaid_item_id,
    userId:       t.owner_user_id   ?? "",
    ownerName:    t.owner_name      ?? undefined,
    merchantName: t.merchant_name   ?? t.name ?? "Unknown",
    category:     t.personal_finance_category ?? t.category[0] ?? "Other",
    amount:       Math.abs(t.amount),
    date:         t.date,
    isFlagged:    t.is_flagged,
    flagReason:   t.flag_reason     ?? undefined,
  };
}

// ---- Seed ----

export const mockUsers: User[] = [
  {
    id: "u_parent",
    name: "Sarah Mitchell",
    email: "parent@usebuffr.com",
    role: "parent",
    status: "active",
    createdAt: "2024-09-01",
    childIds: ["u_student"],
  },
  {
    id: "u_student",
    name: "Jamie Mitchell",
    email: "student@usebuffr.com",
    role: "child",
    status: "active",
    createdAt: "2024-09-02",
    parentId: "u_parent",
    under18: false,
  },
  {
    id: "u_admin",
    name: "Admin User",
    email: "admin@usebuffr.com",
    role: "admin",
    status: "active",
    createdAt: "2024-08-01",
  },
  {
    id: "u_parent2",
    name: "David Chen",
    email: "david@example.com",
    role: "parent",
    status: "active",
    createdAt: "2024-10-12",
    childIds: ["u_student2"],
  },
  {
    id: "u_student2",
    name: "Mia Chen",
    email: "mia@example.com",
    role: "child",
    status: "active",
    createdAt: "2024-10-12",
    parentId: "u_parent2",
    under18: true,
  },
  {
    id: "u_parent3",
    name: "Aisha Patel",
    email: "aisha@example.com",
    role: "parent",
    status: "suspended",
    createdAt: "2024-07-22",
    childIds: [],
  },
];

export const mockAccounts: BankAccount[] = [
  { id: "acc_1", userId: "u_student", bankName: "Chase", mask: "4521", type: "checking", balance: 1240.55 },
  { id: "acc_2", userId: "u_student", bankName: "Chase", mask: "9931", type: "savings", balance: 3200.0 },
  { id: "acc_3", userId: "u_student2", bankName: "Bank of America", mask: "1102", type: "checking", balance: 410.2 },
];

export const mockMerchants: Merchant[] = [
  { id: "m1", name: "DraftKings", category: "gambling", riskLevel: "high" },
  { id: "m2", name: "FanDuel", category: "gambling", riskLevel: "high" },
  { id: "m3", name: "Coinbase", category: "crypto", riskLevel: "medium" },
  { id: "m4", name: "Binance", category: "crypto", riskLevel: "high" },
  { id: "m5", name: "MoneyMutual", category: "payday_loan", riskLevel: "high" },
  { id: "m6", name: "CashNetUSA", category: "payday_loan", riskLevel: "high" },
  { id: "m7", name: "BetMGM", category: "gambling", riskLevel: "high" },
];

const today = new Date();
const day = (d: number) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
};

export const mockTransactions: Transaction[] = [
];

export const mockSmsLogs: SmsLog[] = mockTransactions
  .filter((t) => t.isFlagged)
  .map((t, i) => ({
    id: `sms_${i + 1}`,
    parentId: t.userId === "u_student" ? "u_parent" : "u_parent2",
    transactionId: t.id,
    phone: "+1 (555) 010-" + (1000 + i),
    message: `Buffr Alert: ${t.merchantName} charge of $${t.amount.toFixed(2)} flagged (${t.flagReason}).`,
    status: i % 5 === 0 ? "failed" : "delivered",
    sentAt: t.date,
  }));

export const mockFAQs: FAQ[] = [
  { id: "f1", question: "How does Buffr detect risky transactions?", answer: "Buffr uses AI classification + a curated merchant database to identify gambling, payday loans, crypto, and other high-risk activity." },
  { id: "f2", question: "Who receives SMS alerts?", answer: "Only the Parent receives SMS alerts. Students can view flagged activity in their dashboard." },
  { id: "f3", question: "Can a student unlink their parent?", answer: "No. Only the parent can manage the linked relationship." },
];

// ---- Helpers ----
export const flagCategoryLabel: Record<FlagCategory, string> = {
  gambling: "Gambling",
  payday_loan: "Payday Loan",
  crypto: "Crypto Exchange",
  high_risk: "High Risk",
};
