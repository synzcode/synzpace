import { relatedRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(
  request: Request,
  context: { params: Promise<{ taskId: string; commentId: string }> },
) {
  return relatedRoute(request, { kind: "comments", ...(await context.params) });
}
export { handle as PATCH, handle as DELETE };
const other = () => unsupported("PATCH, DELETE");
export {
  other as GET,
  other as POST,
  other as PUT,
  other as HEAD,
  other as OPTIONS,
};
