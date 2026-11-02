"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Leaf, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const tokens = ["primary", "background", "card", "secondary", "muted", "foreground", "success", "warning", "destructive"];

export default function DesignSystem() {
  const [dark, setDark] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className={`${dark ? "dark" : "light"} min-h-screen bg-background text-foreground transition-colors duration-300`}>
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
        <header className="flex items-center justify-between border-b pb-6">
          <a href="#" className="flex items-center gap-2 text-xl font-medium"><Leaf className="size-6 text-primary" /> synzspace<span className="ml-2 hidden text-sm text-muted-foreground sm:inline">/ theme studio</span></a>
          <Button variant="outline" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? "light" : "dark"} mode`}>{dark ? <Sun /> : <Moon />}{dark ? "Light mode" : "Dark mode"}</Button>
        </header>
        <main className="space-y-10 py-12">
          <section className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div><p className="mb-3 text-sm uppercase tracking-[0.2em] text-muted-foreground">Fresh perspective · 01</p><h1 className="text-5xl font-medium tracking-tight md:text-6xl">A little more organic.</h1><p className="mt-4 max-w-lg text-lg text-muted-foreground">Soft neutrals, a leafy accent, and room to breathe. Your HeroUI palette, at home in shadcn/ui.</p></div>
            <span className="w-fit rounded-full border px-4 py-2 text-sm">Fredoka · 8px radius</span>
          </section>
          <section aria-label="Theme palette" className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {tokens.map(token => <div key={token}><div className="h-20 rounded-lg border" style={{ background: `var(--${token})` }} /><p className="mt-2 text-xs text-muted-foreground capitalize">{token}</p></div>)}
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-xl border bg-card p-7 text-card-foreground">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">01 / Components</p><h2 className="mt-2 text-2xl font-medium">Small details. Big personality.</h2><p className="mt-2 text-muted-foreground">Every action shares the same natural rhythm.</p>
              <div className="mt-7 flex flex-wrap gap-3"><Button>Get started <ArrowUpRight /></Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button><Button disabled>Disabled</Button></div>
              <div className="mt-8 border-t pt-6"><p className="mb-3 text-sm text-muted-foreground">Feedback & status</p><div className="flex flex-wrap gap-2">{["success", "warning", "destructive"].map((status,i)=><span key={status} className="rounded-full px-3 py-1 text-xs" style={{background:`color-mix(in oklch, var(--${status}), transparent 85%)`,color:`var(--${status})`}}>{["Completed", "Needs attention", "Something went wrong"][i]}</span>)}</div></div>
            </section>
            <section className="rounded-xl border bg-card p-7 text-card-foreground">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">02 / In practice</p><h2 className="mt-2 text-2xl font-medium">Make yourself at home.</h2><p className="mt-2 text-muted-foreground">A small space for your next big idea.</p>
              <form className="mt-6 space-y-4" onSubmit={e=>{e.preventDefault();setSaved(true);}}>
                <label className="block text-sm">Workspace name<input required placeholder="My creative corner" onChange={()=>setSaved(false)} className="mt-2 h-11 w-full rounded-[var(--field-radius)] border border-input bg-[var(--field-background)] px-3 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /></label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" defaultChecked className="size-4 accent-primary" /> Keep my workspace private</label>
                <Button type="submit" className="w-full">{saved ? <><Check /> Workspace saved</> : <>Create workspace <ArrowUpRight /></>}</Button>
                <p role="status" className="text-center text-xs text-muted-foreground">{saved ? "Your preview workspace is ready for this session." : "A preview of forms, focus states, and primary actions."}</p>
              </form>
            </section>
          </div>
          <section className="rounded-xl bg-primary p-8 text-primary-foreground"><Leaf className="mb-5 size-8" /><h2 className="text-3xl font-medium">Built to feel a little brighter.</h2><p className="mt-2 max-w-xl opacity-75">One consistent palette across surfaces, buttons, inputs, and feedback. Switch modes above to see the whole system adapt.</p></section>
        </main>
        <footer className="flex justify-between border-t py-6 text-xs text-muted-foreground"><span>synzspace / design foundations</span><span>{dark ? "Dark" : "Light"} appearance · shadcn/ui</span></footer>
      </div>
    </div>
  );
}
