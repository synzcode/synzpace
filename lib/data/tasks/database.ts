import "server-only";
import { requestDeadline } from "./deadline";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DataFailure } from "@/lib/tasks/validation";
import { getPool } from "@/lib/db";
export type Row = Record<string, unknown>;
export type Query = (statement: string, values?: unknown[]) => Promise<Row[]>;
export async function transaction<T>(work: (query: Query) => Promise<T>) {
  const deadline = requestDeadline.getStore() ?? Date.now() + 14000;
  return drizzle(getPool()).transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '5s'`);
    await tx.execute(sql`set local lock_timeout = '2s'`);
    const query: Query = async (statement, values = []) => {
      const remaining = deadline - Date.now();
      if (remaining < 1) throw new DataFailure(504, "REQUEST_TIMEOUT");
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(Math.min(5000, remaining))}, true)`,
      );
      // SQL text is internal and constant. All request values become bound parameters.
      const chunks: SQL[] = [];
      let offset = 0;
      for (const match of statement.matchAll(/\$(\d+)/g)) {
        chunks.push(
          sql.raw(statement.slice(offset, match.index)),
          sql`${sql.param(values[Number(match[1]) - 1])}`,
        );
        offset = match.index! + match[0].length;
      }
      chunks.push(sql.raw(statement.slice(offset)));
      return (await tx.execute(sql.join(chunks, sql.raw("")))).rows as Row[];
    };
    const result = await work(query);
    if (Date.now() >= deadline) throw new DataFailure(504, "REQUEST_TIMEOUT");
    return result;
  });
}
