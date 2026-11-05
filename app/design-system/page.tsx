import { Suspense } from "react";
import { PrivateEntry } from "@/components/auth/private-entry";
import ThemeStudio from "@/components/auth/theme-studio";
export default function DesignSystem({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<p className="p-10" role="status">Checking private access…</p>}><PrivateEntry path="/design-system" searchParams={searchParams}><ThemeStudio /></PrivateEntry></Suspense>;
}
