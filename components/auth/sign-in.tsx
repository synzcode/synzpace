"use client";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessFrame } from "./frame";

const messages: Record<string, string> = { canceled: "Sign in was canceled. You can try again when you are ready.", denied: "This account could not sign in. Try your personal Google account.", failed: "Sign in did not finish. Start a new sign in to try again.", busy: "Account access is busy. Please try again.", unavailable: "Sign in is temporarily unavailable. Please try again later.", throttled: "Too many attempts. Please wait before trying again." };
export function SignIn({ returnTo, reason }: { returnTo: string; reason: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(messages[reason] ?? "");
  const [retryUntil, setRetryUntil] = useState(0);
  const [waiting, setWaiting] = useState(false);
  async function start() {
    if (Date.now() < retryUntil) return;
    setPending(true); setMessage("Opening Google…");
    try {
      const response = await fetch("/api/auth/sign-in/social", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", returnTo }), cache: "no-store" });
      const value = await response.json();
      if (response.status === 429) {
        const seconds = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 60));
        setRetryUntil(Date.now() + seconds * 1000); setWaiting(true); setTimeout(() => setWaiting(false), seconds * 1000);
        setMessage(`Please wait ${seconds} seconds before trying again.`); setPending(false); return;
      }
      const url = new URL(value.url);
      if (!response.ok || value.redirect !== true || url.origin !== "https://accounts.google.com") throw new Error();
      window.location.assign(url.href);
    } catch { setMessage(messages.unavailable); setPending(false); }
  }
  return <AccessFrame title="Welcome to your space." subtitle="A quiet place to return to your work. Sign in with your personal Google account to continue.">
    <p className="mb-2 text-sm text-muted-foreground">Personal account access</p><h2 className="mb-3 text-2xl font-medium">Make yourself at home.</h2><p className="mb-8 text-muted-foreground">Access is private. Public account registration is closed.</p>
    <Button size="lg" className="w-full" disabled={pending || waiting} onClick={() => void start()}>{pending ? "Opening Google…" : "Continue with Google"}<ArrowUpRight aria-hidden="true" /></Button><p className="mt-4 min-h-12 text-sm text-muted-foreground" role="status" aria-live="polite">{message}</p><div className="mt-6 border-t pt-5 text-sm leading-relaxed text-muted-foreground">Google verifies your identity. Your dashboard does not need another password.</div>
  </AccessFrame>;
}
