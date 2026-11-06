import { tasksRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  return tasksRoute(request, await context.params);
}
export { handle as GET, handle as PATCH, handle as DELETE };
const other = () => unsupported("GET, PATCH, DELETE");
export { other as POST, other as PUT, other as HEAD, other as OPTIONS };
