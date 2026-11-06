import { timingSafeEqual } from "node:crypto";
import { cleanupTasks } from "@/lib/data/tasks/cleanup";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const error = (status: number, code: string) =>
    Response.json(
      {
        error: { code, message: "Task maintenance could not complete." },
        meta: { requestId },
      },
      { status, headers },
    );
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim() || !process.env.DATABASE_URL)
    return error(503, "CONFIGURATION_REQUIRED");
  try {const url=new URL(process.env.DATABASE_URL!);if(!url.hostname||!['postgres:','postgresql:'].includes(url.protocol))throw new Error();}catch{return error(503,'CONFIGURATION_REQUIRED');}
  const actual = Buffer.from(request.headers.get("authorization") ?? ""),
    expected = Buffer.from("Bearer " + secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return error(401, "INVALID_CRON_AUTH");
  try {
    return Response.json(await cleanupTasks(requestId), { headers });
  } catch {
    return error(503, "STORAGE_UNAVAILABLE");
  }
}
const unsupported = () =>
  Response.json(
    {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." },
      meta: { requestId: crypto.randomUUID() },
    },
    { status: 405, headers: { ...headers, Allow: "GET" } },
  );
export {
  unsupported as POST,
  unsupported as PATCH,
  unsupported as DELETE,
  unsupported as PUT,
  unsupported as HEAD,
  unsupported as OPTIONS,
};
