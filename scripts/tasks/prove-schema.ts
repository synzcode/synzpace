import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    const columns = await client.query(`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name in ('tasks', 'creation_receipts')`);
    assert.equal(columns.rows.filter(r => r.table_name === "tasks").length, 11);
    assert.equal(columns.rows.filter(r => r.table_name === "creation_receipts").length, 6);
    await client.query("BEGIN");
    const owner = randomUUID();
    await client.query(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, 'Schema proof', $2, false, now(), now())`, [owner, `${owner}@example.invalid`]);
    const id = randomUUID();
    await client.query("insert into tasks(id, owner_id, title, due_date) values ($1,$2,'Schema proof','2028-02-29')", [id, owner]);
    const task = (await client.query("select * from tasks where id=$1 and owner_id=$2", [id, owner])).rows[0];
    assert.equal(task.revision, 1); assert.equal(task.progress, 0); assert.equal(task.description, null);
    assert.equal(task.trashed_at, null);
    for (const statement of [
      "update tasks set title='' where id=$1",
      "update tasks set progress=101 where id=$1",
      "update tasks set revision=0 where id=$1",
    ]) {
      await client.query("SAVEPOINT invalid_value");
      await assert.rejects(client.query(statement, [id]), (error: unknown) => (error as { code: string }).code === "23514");
      await client.query("ROLLBACK TO SAVEPOINT invalid_value");
    }
    const key = randomUUID();
    await client.query("insert into creation_receipts(owner_id,request_id,operation,request_hash,resource_id) values ($1,$2,'create_task',$3,$4)", [owner,key,"a".repeat(64),id]);
    await client.query("delete from tasks where id=$1", [id]);
    assert.equal((await client.query("select resource_id from creation_receipts where owner_id=$1 and request_id=$2", [owner,key])).rows[0].resource_id, id);
    await client.query('delete from "user" where id=$1', [owner]);
    assert.equal((await client.query("select 1 from creation_receipts where owner_id=$1", [owner])).rowCount, 0);
    console.log("Live task schema confirmed. Defaults, bounds, receipt retention, and owner cascade passed. Proof data rolled back.");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}
main().catch((error) => { console.error(error instanceof assert.AssertionError ? { actual: error.actual, expected: error.expected } : { code: error.code, column: error.column }); console.error("Task schema proof failed. Check migration and database configuration."); process.exitCode = 1; });
