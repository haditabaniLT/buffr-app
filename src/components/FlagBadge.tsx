import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function FlagBadge({ reason }: { reason?: string }) {
  if (!reason) return <Badge variant="secondary" className="bg-success/10 text-success border-success/20">Clean</Badge>;
  return (
    <Badge className={cn("bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15")}>
      {reason}
    </Badge>
  );
}
