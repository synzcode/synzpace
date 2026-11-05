export type SessionConfig = { secret: string; origin: string; ownerId: string };

export function sessionConfig(): SessionConfig {
  const secret = process.env.BETTER_AUTH_SECRET;
  const base = process.env.BETTER_AUTH_URL;
  const ownerId = process.env.PERSONAL_ACCOUNT_ID;
  if (!secret || secret.length < 32 || !base || !ownerId) throw new Error("Auth configuration is required.");
  const url = new URL(base);
  if (url.origin !== base || url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("An exact secure auth origin is required.");
  return { secret, origin: url.origin, ownerId };
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google configuration is required.");
  return { clientId, clientSecret };
}
