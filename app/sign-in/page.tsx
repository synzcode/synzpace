import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePersonalSession } from "@/lib/auth/server";
import { privateDestination } from "@/lib/auth/destinations";
import { sessionConfig } from "@/lib/auth/config";
import { SignIn } from "@/components/auth/sign-in";

async function Entry({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  let origin = "http://localhost:3000";
  try { origin = sessionConfig().origin; } catch { /* Generic unavailable sign in remains safe. */ }
  const returnTo = privateDestination(query.returnTo, origin);
  let signedIn = false;
  try { await requirePersonalSession(new Headers(await headers())); signedIn = true; } catch { /* No account details are rendered here. */ }
  if (signedIn) redirect(returnTo);
  return <SignIn returnTo={returnTo} reason={typeof query.reason === "string" ? query.reason : ""} />;
}
export default function SignInPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<p className="p-10" role="status">Opening sign in…</p>}><Entry {...props} /></Suspense>;
}
