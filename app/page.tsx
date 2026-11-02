import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-medium">synzspace</h1>
      <Link
        href="/design-system"
        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        View design system
      </Link>
    </main>
  );
}
