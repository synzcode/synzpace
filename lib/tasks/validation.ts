export class DataFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
    public latest?: { kind: string; record: unknown },
  ) {
    super(code);
  }
}
export function invalid(field = "request"): never {
  throw new DataFailure(422, "VALIDATION_FAILED", {
    [field]: "Check this value.",
  });
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid();
  return value as Record<string, unknown>;
}
export function validUnicode(value: string) {
  return !/[\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
}
export function text(value: unknown, max: number, field: string) {
  if (typeof value !== "string" || !validUnicode(value)) invalid(field);
  const result = value.trim();
  if (!result || [...result].length > max) invalid(field);
  return result;
}
export function uuid(value: unknown, field = "id") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid(field);
  return value.toLowerCase();
}
export function revision(value: unknown) {
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    invalid("expectedRevision");
  return Number(value);
}
export function dueDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid("dueDate");
  const [y, m, d] = value.split("-").map(Number);
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (!y || m < 1 || m > 12 || d < 1 || d > days[m - 1]) invalid("dueDate");
  return value;
}
export const statusFor = (progress: number) =>
  progress === 0 ? "todo" : progress === 100 ? "done" : "in_progress";
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJSON).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalJSON((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
