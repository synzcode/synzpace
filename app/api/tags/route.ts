import { relatedRoute, unsupported } from "@/lib/data/tasks/http";
async function handle(request: Request) {
  return relatedRoute(request, { kind: "tags" });
}
export { handle as GET, handle as POST };
const other = () => unsupported("GET, POST");
export {
  other as PUT,
  other as PATCH,
  other as DELETE,
  other as HEAD,
  other as OPTIONS,
};
