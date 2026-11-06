import { tasksRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  return tasksRoute(request, {
    ...(await context.params),
    action: "permanent",
  });
}
export { handle as DELETE };
const other = () => unsupported("DELETE");
export {
  other as GET,
  other as POST,
  other as PUT,
  other as PATCH,
  other as HEAD,
  other as OPTIONS,
};
