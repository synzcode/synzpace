const pages = new Set(["/", "/account/access", "/design-system"]);
export function privateDestination(value: unknown, origin: string): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return "/";
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash || !pages.has(decodeURIComponent(url.pathname))) return "/";
    url.searchParams.delete("_rsc");
    return url.pathname + url.search;
  } catch { return "/"; }
}
export function pageDestination(path: string, query: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "_rsc") continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  return path + (params.size ? `?${params}` : "");
}
