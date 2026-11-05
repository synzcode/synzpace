import { Suspense } from "react";
import { PrivateEntry } from "@/components/auth/private-entry";
export default function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<p className="p-10" role="status">Checking private access…</p>}><PrivateEntry path="/" searchParams={searchParams} /></Suspense>;
}
