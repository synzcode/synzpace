import Link from "next/link";
import { Leaf, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export function AccessFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="min-h-screen bg-background p-5 text-foreground sm:p-10"><div className="mx-auto max-w-5xl">
    <header className="flex items-center justify-between border-b py-4"><Link href="/" prefetch={false} className="flex items-center gap-2 text-xl font-medium"><Leaf className="size-6 text-primary" aria-hidden="true" />synzspace</Link><span className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4" aria-hidden="true" />Private workspace</span></header>
    <div className="grid gap-8 py-12 md:grid-cols-[1fr_1.15fr] md:gap-16 md:py-20"><section className="space-y-5"><p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">A little space for you</p><h1 className="text-4xl leading-tight font-medium sm:text-5xl">{title}</h1><p className="max-w-sm text-lg leading-relaxed text-muted-foreground">{subtitle}</p><div className="mt-8 rounded-xl border bg-primary/10 p-5 text-sm leading-relaxed"><ShieldCheck className="mb-3 size-6" aria-hidden="true" />Your workspace belongs to your personal account. You choose when your devices stay connected.</div></section><section aria-label="Account access" className="self-start rounded-2xl border bg-card p-6 shadow-sm sm:p-8">{children}</section></div>
    <footer className="border-t py-5 text-sm text-muted-foreground">synzspace · Your work, in your space.</footer>
  </div></main>;
}
