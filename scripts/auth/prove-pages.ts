import assert from "node:assert/strict";
import { Pool } from "pg";
import { serializeSignedCookie } from "better-call";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) throw new Error();
  const origin = process.env.AUTH_PROOF_ORIGIN ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const rows = await pool.query(`SELECT u.email,u.name,s.id,s.token FROM "user" u JOIN session s ON s.user_id=u.id WHERE u.id=$1 AND s.expires_at>clock_timestamp() AND s.created_at+interval '90 days'>clock_timestamp() LIMIT 1`,[process.env.PERSONAL_ACCOUNT_ID]);
    assert(rows.rows.length === 1, "A real session from the Google proof is needed for stream privacy checks.");
    const session = rows.rows[0];
    const cookie = (await serializeSignedCookie("better-auth.session_token",session.token,process.env.BETTER_AUTH_SECRET,{path:"/",httpOnly:true,sameSite:"lax"})).split(";")[0];
    const signIn = await fetch(origin+"/sign-in"); assert.equal(signIn.status,200);
    const publicHtml=await signIn.text(); assert(publicHtml.includes("Continue with Google")); assert(!publicHtml.includes(session.email));
    for(const path of ["/", "/account/access", "/design-system"]) {
      for(const rsc of [false,true]) {
        const headers:Record<string,string>={Cookie:cookie}; if(rsc)headers.RSC="1";
        const response=await fetch(origin+path,{headers}); assert.equal(response.status,200);
        const body=await response.text();
        assert(!body.includes(session.email),"Account email must not appear in initial HTML or RSC.");
        assert(!body.includes(session.token),"Session token must never appear in HTML or RSC.");
        assert(!body.includes(session.id),"Server session ID must never appear in HTML or RSC.");
      }
    }
    const signedOut=await fetch(origin+"/account/access?a=1&a=2&_rsc=transport",{redirect:"manual"});
    const body=await signedOut.text();
    const location=signedOut.headers.get("location");
    assert(location?.includes("sign-in") || body.includes("NEXT_REDIRECT"));
    assert(!body.includes(session.email));
    const json=await fetch(origin+"/api/account/session",{headers:{Cookie:cookie}});assert.equal(json.status,200);
    const value=await json.json();assert.equal(value.data.user.id,process.env.PERSONAL_ACCOUNT_ID);
    const payload=JSON.stringify(value);assert(!payload.includes(session.token) && !payload.includes(session.id));
    console.log("Real app page checks passed: sign in renders, private HTML and RSC contain no account email or session credentials, signed out entry redirects, and guarded JSON returns only the permitted session DTO.");
  } finally {await pool.end();}
}
main().catch(error=>{console.error("Page privacy proof failed:",error instanceof assert.AssertionError?error.message:"Check the development server and database.");process.exitCode=1;});
