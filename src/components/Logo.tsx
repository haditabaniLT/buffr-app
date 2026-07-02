import logoUrl from "@/assets/buffr-logo.png";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 32 }: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt="Buffr logo"
      width={size}
      height={size}
      className={cn("object-contain", className)}
    />
  );
}
