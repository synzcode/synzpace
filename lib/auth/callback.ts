/** Bound raw callback input before any provider request or database mutation. */
export function parseOAuthCallback(rawQuery: string): { state: string; code: string } | { state: string; error: string } {
  if (Buffer.byteLength(rawQuery, "utf8") > 8192) throw new Error("Invalid callback.");
  const bounds = { code: 4096, state: 2048, error: 128, error_description: 1024 };
  const values = new Map<string, string>();
  for (const part of rawQuery.split("&")) {
    if (!part) continue;
    const equal = part.indexOf("=");
    const key = decodeURIComponent((equal < 0 ? part : part.slice(0, equal)).replaceAll("+", " "));
    const value = decodeURIComponent((equal < 0 ? "" : part.slice(equal + 1)).replaceAll("+", " "));
    if (Object.hasOwn(bounds, key)) {
      if (values.has(key) || Buffer.byteLength(value, "utf8") > bounds[key as keyof typeof bounds]) throw new Error("Invalid callback.");
      values.set(key, value);
    }
  }
  const state = values.get("state");
  if (!state) throw new Error("Invalid callback.");
  if (values.has("error")) {
    const error = values.get("error");
    if (!error || values.has("code")) throw new Error("Invalid callback.");
    return { state, error };
  }
  const code = values.get("code");
  if (!code) throw new Error("Invalid callback.");
  return { state, code };
}
