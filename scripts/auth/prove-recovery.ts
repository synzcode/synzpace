import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../lib/db/schema/auth";
import { databaseNow } from "../../lib/db/clock";
import { mutatePersonalBinding, OperatorRefusal } from "../../lib/auth/operator-data";
async function main() {
  if(process.env.AUTH_PROOF_DEVELOPMENT!=="true" || !process.env.DATABASE_URL_UNPOOLED || !process.env.PERSONAL_ACCOUNT_ID) throw new Error();
  const pool=new Pool({connectionString:process.env.DATABASE_URL_UNPOOLED,max:1,connectionTimeoutMillis:15000});
  const db=drizzle(pool,{schema}); const ownerId=process.env.PERSONAL_ACCOUNT_ID; const rollback=new Error("Expected proof rollback");
  try {
    await assert.rejects(db.transaction(async tx=>{
      assert.equal((await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`)).rows[0]?.locked,true);
      const now=await databaseNow(tx);
      const [owner]=await tx.select().from(schema.user).where(eq(schema.user.id,ownerId));
      const [binding]=await tx.select().from(schema.account).where(and(eq(schema.account.userId,ownerId),eq(schema.account.providerId,"google")));
      assert(owner&&binding);
      const before=await tx.select({id:schema.session.id}).from(schema.session).where(eq(schema.session.userId,ownerId));
      const current={subject:binding.accountId,email:owner.email,name:owner.name};
      assert.equal(await mutatePersonalBinding(tx,current,false,ownerId,now),ownerId);
      assert.equal((await tx.select().from(schema.session).where(eq(schema.session.userId,ownerId))).length,before.length);
      const replacement={...current,subject:randomUUID()};
      await assert.rejects(mutatePersonalBinding(tx,replacement,false,ownerId,now),OperatorRefusal);
      const proof=randomUUID(); await tx.insert(schema.verification).values({id:proof,identifier:proof,value:"proof",expiresAt:new Date(now.getTime()+600000)});
      assert.equal(await mutatePersonalBinding(tx,replacement,true,ownerId,now),ownerId);
      const [changed]=await tx.select().from(schema.account).where(eq(schema.account.id,binding.id));assert.equal(changed.accountId,replacement.subject);
      assert.equal((await tx.select().from(schema.session).where(eq(schema.session.userId,ownerId))).length,0);
      assert.equal((await tx.select().from(schema.verification)).length,0);
      assert.equal(await mutatePersonalBinding(tx,replacement,true,ownerId,now),ownerId);
      assert.equal((await tx.select().from(schema.user)).length,1);
      assert.equal((await tx.select().from(schema.account).where(eq(schema.account.userId,ownerId))).length,1);
      throw rollback;
    }),error=>error===rollback);
    console.log("Shared setup and recovery data path passed: setup retry preserves sessions, another subject cannot enroll, recovery keeps the same user and binding row, revokes sessions and proofs, and retries without duplication. All recovery test changes rolled back.");
  } finally {await pool.end();}
}
main().catch(error=>{console.error("Recovery proof failed:",error instanceof assert.AssertionError?error.message:"Check the development database.");process.exitCode=1;});
