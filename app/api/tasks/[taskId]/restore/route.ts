import { tasksRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  return tasksRoute(request, { ...(await context.params), action: "restore" });
}
export { handle as POST };
const other = () => unsupported("POST");
export {
  other as GET,
  other as PUT,
  other as PATCH,
  other as DELETE,
  other as HEAD,
  other as OPTIONS,
};
