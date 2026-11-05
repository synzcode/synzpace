import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requirePersonalSession } from "@/lib/auth/server";
import { pageDestination } from "@/lib/auth/destinations";
import { AuthFailure } from "@/lib/auth/errors";
import { PrivateGate } from "./private-gate";

export async function PrivateEntry({ path, searchParams, account, children }: { path: string; searchParams: Promise<Record<string, string | string[] | undefined>>; account?: boolean; children?: ReactNode }) {
  try { await requirePersonalSession(new Headers(await headers())); }
  catch (error) {
    if (error instanceof AuthFailure && error.status === 401) redirect(`/sign-in?returnTo=${encodeURIComponent(pageDestination(path, await searchParams))}`);
    return <PrivateGate account={account} />;
  }
  return <PrivateGate account={account}>{children}</PrivateGate>;
}
