import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border border-border bg-card text-card-foreground", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}
