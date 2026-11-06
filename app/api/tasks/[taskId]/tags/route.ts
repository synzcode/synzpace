import { relatedRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  return relatedRoute(request, {
    kind: "assignments",
    ...(await context.params),
  });
}
export { handle as PUT };
const other = () => unsupported("PUT");
export {
  other as GET,
  other as POST,
  other as PATCH,
  other as DELETE,
  other as HEAD,
  other as OPTIONS,
};
