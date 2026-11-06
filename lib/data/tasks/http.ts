import "server-only";
import { requestDeadline } from "./deadline";
import { requirePersonalSession } from "@/lib/auth/server";
import { sessionConfig } from "@/lib/auth/config";
import { AuthFailure } from "@/lib/auth/errors";
import { DataFailure, object, uuid } from "@/lib/tasks/validation";
import { taskOperation } from "./service";
const headers = { "Cache-Control": "private, no-store" };
export function failure(error: unknown, requestId = crypto.randomUUID()) {
  const code =
    error instanceof DataFailure || error instanceof AuthFailure
      ? error.code
      : typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
  const cause =
    error instanceof Error &&
    error.cause &&
    typeof error.cause === "object" &&
    "code" in error.cause
      ? String(error.cause.code)
      : code;
  const timeout = ["57014", "55P03", "REQUEST_TIMEOUT"].includes(cause) || error instanceof Error && ["AbortError","TimeoutError"].includes(error.name);
  const known = error instanceof DataFailure || error instanceof AuthFailure;
  const storage =
    !!cause ||
    (error instanceof Error &&
      (error.cause instanceof Error || /connection|database|fetch|socket|query/i.test(error.message)));
  const status = known ? error.status : timeout ? 504 : storage ? 503 : 500;
  const stable = known
    ? code
    : timeout
      ? "REQUEST_TIMEOUT"
      : storage
        ? "STORAGE_UNAVAILABLE"
        : "INTERNAL_ERROR";
  return Response.json(
    {
      error: {
        code: stable,
        message:
          stable === "VALIDATION_FAILED"
            ? "Check the marked values."
            : "The request could not complete. Keep your draft and review this result before retrying.",
        ...(error instanceof DataFailure && error.fields
          ? { fields: error.fields }
          : {}),
        ...(error instanceof DataFailure && error.latest
          ? { latest: error.latest }
          : {}),
      },
      meta: { requestId },
    },
    { status, headers },
  );
}
export function unsupported(allow: string) {
  return Response.json(
    {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use a supported method." },
      meta: { requestId: crypto.randomUUID() },
    },
    { status: 405, headers: { ...headers, Allow: allow } },
  );
}
export async function body(request: Request, keys: string[]) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new DataFailure(415, "UNSUPPORTED_MEDIA_TYPE");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = requestDeadline.getStore() ?? Date.now() + 15000;
  if (reader)
    try {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                void reader.cancel();
                reject(new DataFailure(504, "REQUEST_TIMEOUT"));
              },
              Math.max(1, deadline - Date.now()),
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (Date.now() >= deadline)
          throw new DataFailure(504, "REQUEST_TIMEOUT");
        const { value, done } = next;
        if (done) break;
        length += value.byteLength;
        if (length > 262144) {
          await reader.cancel();
          throw new DataFailure(413, "PAYLOAD_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new DataFailure(400, "INVALID_JSON");
  }
  return object(value, keys);
}
export async function authorize(request: Request) {
  try {
    sessionConfig();
    const value = new URL(process.env.DATABASE_URL ?? "");
    if (
      !value.hostname ||
      !process.env.PERSONAL_ACCOUNT_ID?.trim() ||
      !["postgres:", "postgresql:"].includes(value.protocol)
    )
      throw new Error();
  } catch {
    console.warn(
      JSON.stringify({
        operation: "tasks.configuration",
        missing: [
          "DATABASE_URL",
          "BETTER_AUTH_SECRET",
          "BETTER_AUTH_URL",
          "PERSONAL_ACCOUNT_ID",
        ].filter((k) => !process.env[k]?.trim()),
        resultCode: "CONFIGURATION_REQUIRED",
      }),
    );
    throw new DataFailure(503, "CONFIGURATION_REQUIRED");
  }
  const session = await requirePersonalSession(request.headers);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("origin") !== sessionConfig().origin
  )
    throw new DataFailure(403, "ORIGIN_FORBIDDEN");
  return session.userId;
}
export function response(
  result: { data: unknown; serverNow: string; replayed?: boolean },
  method: string,
  requestId: string,
) {
  return Response.json(
    {
      data: result.data,
      meta: {
        requestId,
        serverNow: result.serverNow,
        ...(result.replayed !== undefined ? { replayed: result.replayed } : {}),
      },
    },
    {
      status: method === "POST" && result.replayed === false ? 201 : 200,
      headers,
    },
  );
}
async function handleTasksRoute(
  request: Request,
  params: { taskId?: string; action?: string } = {},
) {
  const requestId = crypto.randomUUID(),
    started = Date.now();
  let resultCode = "INTERNAL_ERROR";
  try {
    const owner = await authorize(request);
    const id = params.taskId ? uuid(params.taskId) : undefined;
    const method = request.method;
    const keys = !id
      ? ["title"]
      : params.action === "permanent"
        ? ["expectedRevision", "confirmed"]
        : method === "PATCH"
          ? [
              "expectedRevision",
              "title",
              "description",
              "descriptionVersion",
              "dueDate",
              "status",
              "progress",
            ]
          : ["expectedRevision"];
    const input = method === "GET" ? {} : await body(request, keys);
    const key =
      method === "POST" && !id
        ? uuid(request.headers.get("Idempotency-Key"), "Idempotency-Key")
        : undefined;
    const result = await taskOperation(
      owner,
      method,
      id,
      params.action,
      input,
      new URL(request.url),
      key,
    );
    resultCode = "OK";
    return response(result, method, requestId);
  } catch (error) {
    const result = failure(error, requestId);
    resultCode = String((await result.clone().json()).error.code);
    return result;
  } finally {
    console.log(
      JSON.stringify({
        operation: "tasks." + request.method,
        requestId,
        elapsedMs: Date.now() - started,
        resultCode,
        conflictCount: resultCode === "REVISION_CONFLICT" ? 1 : 0,
      }),
    );
  }
}

async function handleRelatedRoute(
  request: Request,
  params: {
    taskId?: string;
    tagId?: string;
    commentId?: string;
    kind: "tags" | "comments" | "assignments";
  },
) {
  const requestId = crypto.randomUUID(),
    started = Date.now();
  let resultCode = "INTERNAL_ERROR";
  try {
    const owner = await authorize(request);
    const method = request.method;
    const taskId = params.taskId ? uuid(params.taskId) : undefined,
      tagId = params.tagId ? uuid(params.tagId) : undefined,
      commentId = params.commentId ? uuid(params.commentId) : undefined;
    const keys =
      params.kind === "assignments"
        ? ["expectedRevision", "tagIds"]
        : method === "DELETE"
          ? ["expectedRevision"]
          : params.kind === "comments"
            ? ["expectedRevision", "body"]
            : ["expectedRevision", "name"];
    const input =
      method === "GET"
        ? {}
        : await body(
            request,
            method === "POST"
              ? keys.filter((k) => k !== "expectedRevision")
              : keys,
          );
    const key =
      method === "POST"
        ? uuid(request.headers.get("Idempotency-Key"), "Idempotency-Key")
        : undefined;
    const { tagOperation, assignmentOperation, commentOperation } =
      await import("./related");
    const result =
      params.kind === "assignments"
        ? await assignmentOperation(owner, taskId!, input)
        : params.kind === "comments"
          ? await commentOperation(
              owner,
              method,
              taskId!,
              commentId,
              input,
              new URL(request.url),
              key,
            )
          : await tagOperation(
              owner,
              method,
              tagId,
              input,
              new URL(request.url),
              key,
            );
    resultCode = "OK";
    return response(result, method, requestId);
  } catch (error) {
    const result = failure(error, requestId);
    resultCode = String((await result.clone().json()).error.code);
    return result;
  } finally {
    console.log(
      JSON.stringify({
        operation: params.kind + "." + request.method,
        requestId,
        elapsedMs: Date.now() - started,
        resultCode,
        conflictCount: resultCode === "REVISION_CONFLICT" ? 1 : 0,
      }),
    );
  }
}

export function tasksRoute(
  request: Request,
  params: Parameters<typeof handleTasksRoute>[1] = {},
) {
  return requestDeadline.run(Date.now() + 15000, () =>
    handleTasksRoute(request, params),
  );
}
export function relatedRoute(
  request: Request,
  params: Parameters<typeof handleRelatedRoute>[1],
) {
  return requestDeadline.run(Date.now() + 15000, () =>
    handleRelatedRoute(request, params),
  );
}
