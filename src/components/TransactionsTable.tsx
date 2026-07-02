import { useMemo, useState } from "react";
import type { Transaction } from "@/lib/mock-data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlagBadge } from "./FlagBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TransactionsTable({
  transactions,
  showPerson = false,
}: {
  transactions: Transaction[];
  /** @deprecated no longer used — kept for backward-compat call sites */
  flaggedOnly?: boolean;
  showPerson?: boolean;
}) {
  const [merchant,  setMerchant]  = useState("");
  const [category,  setCategory]  = useState("all");
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const [amtMin,    setAmtMin]    = useState("");
  const [amtMax,    setAmtMax]    = useState("");
  const [active,    setActive]    = useState<Transaction | null>(null);

  // Unique categories derived from the data
  const categories = useMemo(() => {
    const set = new Set(transactions.map((t) => t.category).filter(Boolean));
    return Array.from(set).sort();
  }, [transactions]);

  const rows = useMemo(() => {
    const min = amtMin !== "" ? parseFloat(amtMin) : null;
    const max = amtMax !== "" ? parseFloat(amtMax) : null;
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to   = dateTo   ? new Date(dateTo + "T23:59:59").getTime() : null;

    return transactions
      .filter((t) => !merchant || t.merchantName.toLowerCase().includes(merchant.toLowerCase()))
      .filter((t) => category === "all" || t.category === category)
      .filter((t) => min === null || t.amount >= min)
      .filter((t) => max === null || t.amount <= max)
      .filter((t) => from === null || new Date(t.date).getTime() >= from)
      .filter((t) => to   === null || new Date(t.date).getTime() <= to)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  }, [transactions, merchant, category, amtMin, amtMax, dateFrom, dateTo]);

  const hasActiveFilters = merchant || category !== "all" || dateFrom || dateTo || amtMin || amtMax;

  const clearFilters = () => {
    setMerchant(""); setCategory("all");
    setDateFrom(""); setDateTo("");
    setAmtMin(""); setAmtMax("");
  };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Merchant search */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <span className="text-xs text-muted-foreground">Merchant</span>
          <Input
            placeholder="Search…"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-xs text-muted-foreground">Category</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Date range */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs text-muted-foreground">From date</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs text-muted-foreground">To date</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Amount range */}
        <div className="flex flex-col gap-1 min-w-[90px]">
          <span className="text-xs text-muted-foreground">Min $</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amtMin}
            onChange={(e) => setAmtMin(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[90px]">
          <span className="text-xs text-muted-foreground">Max $</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="—"
            value={amtMax}
            onChange={(e) => setAmtMax(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Clear + count */}
        <div className="flex items-end gap-2 ml-auto pb-0.5">
          {hasActiveFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-xs">
              Clear filters
            </Button>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {rows.length} result{rows.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merchant</TableHead>
              {showPerson && <TableHead>Person</TableHead>}
              <TableHead>Category</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Risk signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4 + (showPerson ? 1 : 0) + 2}
                  className="text-center text-muted-foreground py-10"
                >
                  No transactions found
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => setActive(t)}>
                <TableCell className="font-medium">{t.merchantName}</TableCell>
                {showPerson && (
                  <TableCell className="text-muted-foreground">{t.ownerName ?? "—"}</TableCell>
                )}
                <TableCell className="text-muted-foreground">{t.category}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(t.date).toLocaleDateString()}</TableCell>
                <TableCell className="text-right tabular-nums">${t.amount.toFixed(2)}</TableCell>
                <TableCell><FlagBadge reason={t.isFlagged ? t.flagReason : undefined} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Detail dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transaction Detail</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-3 text-sm">
              <Row k="Merchant"    v={active.merchantName} />
              {active.ownerName  && <Row k="Person"   v={active.ownerName} />}
              <Row k="Category"   v={active.category} />
              <Row k="Amount"     v={`$${active.amount.toFixed(2)}`} />
              <Row k="Date"       v={new Date(active.date).toLocaleString()} />
              <Row k="Risk signal" v={active.isFlagged ? `Flagged — ${active.flagReason ?? "risk detected"}` : "None"} />
              {active.riskScore !== undefined && <Row k="Risk Score" v={`${active.riskScore} / 100`} />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b last:border-0 py-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
