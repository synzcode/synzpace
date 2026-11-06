import "server-only";
import { requestDeadline } from "./deadline";
import { transaction } from "./database";
export async function cleanupTasks(requestId = crypto.randomUUID()) {
  return requestDeadline.run(Date.now() + 14000, async () => {
    const deadline = requestDeadline.getStore()!;
    let purged = 0;
    try {
      for (let i = 0; i < 5 && Date.now() < deadline - 1500; i++) {
        const count = await transaction(async (q) => {
          const rows =
            await q(`with batch as (select id from tasks where trashed_at + interval '720 hours' <= clock_timestamp() order by trashed_at,id limit 100 for update skip locked)
      delete from tasks where id in (select id from batch) and trashed_at + interval '720 hours' <= clock_timestamp() returning id`);
          return rows.length;
        });
        purged += count;
        if (count < 100) break;
      }
      const remainingEligible = await transaction(async (q) =>
        Boolean(
          (
            await q(
              "select exists(select 1 from tasks where trashed_at + interval '720 hours' <= clock_timestamp()) as eligible",
            )
          )[0].eligible,
        ),
      );
      console.log(
        JSON.stringify({
          operation: "tasks.cleanup",
          requestId,
          purged,
          remainingEligible,
          resultCode: "OK",
        }),
      );
      return { purged, remainingEligible };
    } catch (error) {
      console.log(
        JSON.stringify({
          operation: "tasks.cleanup",
          requestId,
          purged,
          resultCode: "STORAGE_UNAVAILABLE",
        }),
      );
      throw error;
    }
  });
}
