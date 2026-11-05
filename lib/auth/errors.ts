export class AuthFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function authErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "AUTH_BUSY") error = new AuthFailure(409, "AUTH_BUSY", "Account access is busy. Try again.");
  if (error instanceof Error && error.message === "REQUEST_TIMEOUT") error = new AuthFailure(504, "REQUEST_TIMEOUT", "The result is uncertain. Retry explicitly.");
  const failure = error instanceof AuthFailure ? error : new AuthFailure(503, "STORAGE_UNAVAILABLE", "Private access is temporarily unavailable.");
  return Response.json({ error: { code: failure.code, message: failure.message }, meta: { requestId: crypto.randomUUID() } }, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
}
