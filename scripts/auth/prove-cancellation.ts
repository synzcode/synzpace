import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import * as schema from "../../lib/db/schema/auth";
import { runAuthMutation } from "../../lib/auth/transaction";
async function main() {
  if(process.env.AUTH_PROOF_DEVELOPMENT!=="true" || !process.env.DATABASE_URL)throw new Error();
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:15000});
  const id=randomUUID(); const controller=new AbortController(); let release!:()=>void;let staged!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});const ready=new Promise<void>(resolve=>{staged=resolve;});
  try {
    const operation=runAuthMutation(pool,async(tx,now)=>{
      await tx.insert(schema.verification).values({id,identifier:id,value:"proof",expiresAt:new Date(now.getTime()+600000)});
      staged(); await waiting;
      return Response.json({success:true},{headers:{"Set-Cookie":"proof=must-not-escape"}});
    },controller.signal);
    const rejected=assert.rejects(operation,/REQUEST_TIMEOUT/);
    await ready;controller.abort();await rejected;release();
    const result=await pool.query('SELECT 1 FROM verification WHERE id=$1',[id]);assert.equal(result.rowCount,0);
    console.log("Cancellation returns no staged success response and destroys the transaction connection. Its writes do not commit after the delayed operation resumes.");
  } finally {release?.();await pool.end();}
}
main().catch(error=>{console.error("Cancellation proof failed:",error instanceof assert.AssertionError?error.message:"Check database availability.");process.exitCode=1;});
