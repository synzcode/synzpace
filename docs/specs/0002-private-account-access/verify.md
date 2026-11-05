# Verify: private account access · spec 0002 · updated 2026-11-04

_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` can lock the durable cases when you choose it._

## Current evidence

Your verified local setup completed and returned the configured personal user ID. You reported that the real Google integration proof passed in your browser. The permanent access pages, JSON routes, client gate, sign out actions, recovery command, and bounded cleanup are implemented.

The command proofs below passed against the development database or the client controller. The production build and full repository lint passed. Private HTML and React Server Component responses were checked against a real session with a temporary development server on port 3107. They contained no account email, session ID, or session token. These response checks did not visually inspect the pages in a browser.

The feature stays in progress. A second device, browser restart, real replacement Google identity, browser failure and race scenarios, phone layout, and deployed platform checks still need verification. The task editor does not exist yet, so its real draft and ownership checks remain integration work for spec 0001. The maintenance secret request timed out. Configure `CRON_SECRET` privately before checking hosted cleanup.

## Commands

You can run commands from the project root. The scripts load your ignored `.env.local`. Use the development database, since some proofs temporarily write fixtures. The Google proof opens a local server on port 3000. Stop another server using that port before starting it.

* [x] `npm run db:migrate` applied the first auth migration, confirmed all five tables, and safely completed a repeat run. Live account uniqueness constraints, foreign keys, session indexes, and cleanup indexes were also inspected. AC-13.
* [x] `npm run auth:prove-rollback` proved that user, account, session, and verification writes were visible on the locked transaction connection and absent after injected rollback. AC-11, AC-13, AC-14.
* [x] `npm run auth:prove-operator-clock` proved that the database clock becomes a valid JavaScript Date before timestamp inserts and updates. Its fixtures rolled back. AC-1, AC-7, AC-13.
* [x] `npm run auth:prove-callback` checked encoded byte bounds, strict decoding, duplicate decoded security parameters, canceled local verification, and an occupied operator callback port. AC-1, AC-2, AC-10, AC-11.
* [x] `npm run auth:prove-attempts` exercised simultaneous attempts from two independent pools, fixed window limits, retry delay bounds, address normalization, and counter retention after a separate transaction rolls back. AC-11, AC-14.
* [x] `npm run auth:prove-state` checked ten minute database proof expiry, signed cookie enforcement, consumption, replay rejection, expiry, invalidation, and rejected direct ID token input. It used provider cancellation callbacks without calling Google and rolled its fixtures back. AC-2, AC-6, AC-10, AC-11, AC-14.
* [x] `npm run auth:prove-identity-policy` rejected another subject with the same email, unverified profiles, forged owner input, and missing request identity. It checked token suppression hooks and rolled back its changes. This is policy evidence, separate from Google's real token verification. AC-2, AC-3, AC-11, AC-14.
* [x] `npm run auth:prove-sessions` checked ordinary reads, POST renewal, unchanged creation time, the stored 90 day limit, the final cookie limit, expired and revoked sessions, device revocation, safe repeated device sign out, and missing verified identity. Google and Cron settings were not passed to the session instance. AC-3, AC-4, AC-5, AC-13, AC-14.
* [x] `npm run auth:prove-response-order` ran the actual library sign in handler, injected failure after proof writes and cookie staging, and confirmed that no response escaped and no proof remained. A successful operation exposed its response only after its proof committed. AC-6, AC-10, AC-11, AC-14.
* [x] `npm run auth:prove-cancellation` canceled a transaction while its operation was paused. It received no staged success response, and the delayed operation could not commit its writes after resuming. AC-10, AC-11, AC-14.
* [x] `npm run auth:prove-google` completed with your provisioned identity in the real browser flow. It checked the resulting database session, empty provider token columns, discarded avatar, and response after commit. AC-2, AC-3, AC-11, AC-14.
* [x] `npm run auth:prove-api` checked the permanent route handlers for endpoint exposure, method restrictions, exact Origin, JSON byte limits and fields, signed out denial, safe repeated device sign out, malformed callbacks, and local destinations. AC-2, AC-3, AC-5, AC-8, AC-10, AC-11.
* [x] `npm run auth:prove-client-gate` checked pending records before startup reads and rendering, hidden tab behavior, invalidated late reads, captured destinations, overlapping device and global records, rejected scope downgrade, corrupt records, and unavailable storage. This uses browser substitutes, so the real tab checks below remain open. AC-6, AC-8, AC-9, AC-10, AC-14.
* [x] `npm run auth:prove-recovery` exercised the shared operator data path under rollback. Setup retry retained sessions. Another subject could not enroll. Replacement kept the same user and account row, revoked sessions and proofs, and repeated without duplication. Your real binding and sessions were restored by rollback. AC-1, AC-2, AC-6, AC-7, AC-13.
* [x] `npm run auth:prove-cleanup` removed expired sessions, sessions older than 90 days, expired proofs, and stale counters. Active fixtures survived. Fixture rows were removed afterward. AC-4, AC-12.
* [x] The page privacy proof passed against the running application. To repeat it, start `npm run dev`, then run `npm run auth:prove-pages` in another terminal with a real signed in session still present. You can set `AUTH_PROOF_ORIGIN` to an alternate local test origin. AC-3, AC-8, AC-14.
* [x] `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` passed. The lint configuration excludes installed skill examples from application lint. AC-13, AC-14.
* [x] `npm run auth:cleanup` completed deliberate local maintenance and reported zero eligible records remaining. Its pure cleanup module imports no Google, owner, or signing configuration. The explicit configuration omission matrix below still needs verification. AC-12, AC-13.

## UI and browser checks

You can start with `npm run dev` and open `/sign-in` or `/account/access`. The Google client needs both the local operator callback and the application callback registered exactly as specified in the decision.

* [ ] Open `/`, `/account/access`, and `/design-system` while signed out. Each private page redirects to sign in, and no account details appear during loading. Repeat with repeated query values and `_rsc`; the return destination keeps the application query and omits `_rsc`. AC-3, AC-8, AC-14.
* [ ] Sign in through the permanent page with the provisioned account. Reload, close and restart the browser, then open the account page. Its email comes from guarded SessionDTO JSON and the session remains remembered within its limits. AC-2, AC-3, AC-4, AC-8.
* [ ] Sign in with the same identity on a second device using an exact registered HTTPS application origin. Both sessions work and belong to the same personal user. A second browser profile helps check independent cookies locally, but does not complete the physical device or deployed platform check. AC-1, AC-2, AC-3, AC-4, AC-14.
* [ ] Try a different real Google subject, including a case where email matching might otherwise suggest linking. No session or extra user is created. The public message reveals no provisioned identity. AC-2, AC-10, AC-11.
* [ ] Cancel Google's prompt, interrupt a flow, expire its proof, and retry. Only safe reason messages appear. Raw provider descriptions and URLs are not echoed. AC-2, AC-10, AC-11.
* [ ] Keep an authenticated tab visible, hide it, and return focus. Inspect network requests: visible checks run every 60 seconds, hidden tabs send no heartbeat, and reads alone never renew. Observe renewal only when database time is past `renewAfter`. AC-4, AC-9.
* [ ] Use controlled development session timestamps to check just before, at, and after inactivity expiry and the exact 90 day boundary. Stored expiry and the final cookie never extend past the absolute limit. Repeat while cookie writes are denied. AC-4, AC-10, AC-14.
* [ ] With a task draft registered through the shared controller contract, expire the session. The saved private view disappears and reads and writes pause. Copy the draft, open sign in in another tab, and return focus. Only a fresh server check for the same personal user resumes access. The draft stays in memory, and an uncertain task write still needs explicit Retry. AC-9, AC-10.
* [ ] Before device sign out with a draft, exercise Copy draft and Cancel. Deliberate continuation revokes this session, clears private state only after confirmed success, and uses a full navigation to sign in. Another device remains signed in. AC-5, AC-10.
* [ ] Confirm global sign out. Every personal session and outstanding OAuth proof is revoked, including the current device. Inspect the accessible confirmation with keyboard navigation, Escape, and restored focus. AC-6, AC-8, AC-10.
* [ ] Race a callback before and after global revocation. A callback that commits first is revoked. An invalidated proof cannot create a later session. Lock contention produces a safe explicit retry or restarted sign in. AC-6, AC-11, AC-14.
* [ ] Lose device sign out responses both before and after cookie deletion headers reach the browser. Access stays locked and no completion is claimed. Retry succeeds with an existing cookie, a revoked token, or no cookie. AC-5, AC-10.
* [ ] Lose a global sign out response. If retry receives 401, keep its original intent, sign in in a separate tab, and explicitly confirm global sign out again. A new session alone must not unlock the original tab or remove the intent. AC-6, AC-10.
* [ ] Begin device and global operations in different tabs, and finish the older operation last. Each completion removes only its own UUID key. Global records stay ahead of device records, and retry never changes an existing scope. Repeat with multiple records. AC-6, AC-10.
* [ ] Reload and prefetch private pages while a sign out record exists. No private JSON read or renewal begins, and initial HTML and RSC contain no private details. Resolve each pending operation explicitly. AC-8, AC-10, AC-14.
* [ ] Block localStorage or corrupt an intent value. The generic view stays locked. The current operation remains available in memory when possible. Restore storage and use Retry; corrupt records require explicit global confirmation. AC-10, AC-11.
* [ ] Check sign in, account access, paused access, throttling, pending actions, and failure messages on phone and desktop widths with keyboard and screen reader announcements. AC-8, AC-10.

## Local recovery and operations

* [ ] Repeat `npm run auth:setup` with the current verified identity. It returns the same personal user ID and preserves sessions. Cancel confirmation and allow its ten minute window to expire; neither makes an account change. AC-1, AC-7.
* [ ] Run `npm run auth:recover` with a different verified Google identity and deliberate terminal confirmation. It preserves the dashboard user ID, replaces the Google subject, clears provider tokens, and revokes sessions and proofs. Inspect task ownership when task tables exist. AC-1, AC-2, AC-6, AC-7, AC-12.
* [ ] Interrupt recovery before commit, then simulate an uncertain connection result at commit. Rerun with the same identity. There is one owner and one Google binding, with no duplicate user or partial ownership change. AC-1, AC-7, AC-13.
* [ ] Race recovery against callbacks and renewal, using the same transaction lock. No stale identity or revoked session can restore access. AC-6, AC-7, AC-14.
* [ ] Omit Google and Cron settings during ordinary valid session access. Omit runtime settings during migration and generation. Omit Google, owner, and signing settings during maintenance. Each capability validates only its own inputs. AC-3, AC-13, AC-14.
* [ ] Fail the counter store and the session store separately. No access is granted and no process memory limiter replaces Neon. Rejected sign out keeps the view locked and releases no uncommitted cookie deletion headers. AC-10, AC-11.
* [ ] Overlap cleanup runs and renew a session while a sweep is active. Removal batches stay at most 100 per kind, valid sessions survive, and cleanup delay never extends authorization. Inspect backlog reporting and the request deadline. AC-4, AC-12.
* [ ] Configure a separate `CRON_SECRET` privately and test the cleanup route with missing, wrong, and correct bearer authorization. Ordinary account access still works without the Cron setting. AC-11, AC-12, AC-13.
* [ ] On the selected hosting plan, confirm the daily `0 3 * * *` UTC schedule is supported. Preserve any task cleanup schedule. Use an exact production HTTPS origin and a separate production Google client. AC-11, AC-12, AC-13.
* [ ] On Vercel, spoof forwarding headers and inspect the resolved address behavior. Inspect production Secure, HttpOnly, SameSite, path, and domain cookie attributes. Logs and JSON contain no provider credentials, identity details in operational events, or private task content. AC-2, AC-11, AC-12.
* [ ] Keep the reviewed auth migration as the first shared migration. Later task and receipt migrations reuse its auth schema and pool. Compatible rollback does not reopen enrollment or change ownership. AC-13.

## Value sourcing checks

Each row follows the value sourcing table in the governing spec. The command evidence above covers several rows, while the remaining real interactions stay open.

| Action | Check the named source and its failure edge | Evidence or remaining check |
| :--- | :--- | :--- |
| Setup and recovery identity | Confirmation shows only claims from Google's verified ID token. Wrong nonce, issuer, audience, expiry, state, or unverified email makes no write. | Real setup passed. Callback bounds passed. Live replacement and token failure cases remain. |
| First setup IDs | UUIDs are generated inside the confirmed setup transaction. Competing setup attempts cannot create another owner. | Real setup and repeat data path passed. Racing live setup remains. |
| Existing owner and binding | Repeat setup reads auth rows; recovery targets configured `PERSONAL_ACCOUNT_ID`. A different subject cannot silently replace it. | Recovery data proof passed. Real replacement remains. |
| Authorization | The signed library cookie, live session, configured owner, and Google binding determine access. Forged user input supplies none of these. | Session, identity policy, API, and page proofs passed. Deployed platform checks remain. |
| Renewal times | Database time, stored creation and update times, and the specified constants determine the sliding and absolute limits. Vary timestamps at each exact boundary. | Session and clock proofs passed. Browser cookie denial and time boundary checks remain. |
| Account display | Email and name come only from guarded SessionDTO. Initial HTML and RSC must not contain them. | Guarded JSON and page response proof passed. Visual browser check remains. |
| Private page destination | Page pathname and reconstructed query supply `returnTo`. Repeated values survive; `_rsc` is removed. | Destination and page entry checks passed. Manual return flow remains. |
| Separate tab destination | The original tab's current path and query supply the new sign in URL. The sign in tab URL is not its source. | Controller destination capture passed. Real draft reauthentication remains. |
| Return after sign in | A server validated destination in library OAuth state supplies the callback destination, followed by final validation and `/` fallback. | State and destination proofs passed. Permanent page return flow remains. |
| Device revocation target | Only the verified current cookie selects the session to remove, including an unusable old cookie. | Session revocation and repeated device API checks passed. Response loss in a browser remains. |
| Global revocation target | A live personal session and explicit confirmation select the user and proof invalidation. | Confirmation input and shared deletion rules checked. Live global race checks remain. |
| Resume a draft | A fresh SessionDTO user ID must match the original confirmed user ID retained by the controller. | Controller implements the comparison. Real editor integration and changed identity checks remain. |
| Retry operation | The initiating tab generates a UUID once. Its key and immutable scope supply each retry. | Controller overlapping intent and downgrade checks passed. Real tab races remain. |
| Private gate | Enumerated intent records determine the lock. Any global record takes precedence. Empty readable storage permits a fresh session check. | Controller startup, storage failure, corrupt value, and late read checks passed. Browser reload and prefetch checks remain. |
| Throttle | The platform address, HMAC, database clock, atomic counter, and fixed rule determine allowance and retry delay. | Two pool concurrency proof passed. Vercel spoof resistance remains. |
| Callback reason | Bounded decoded parameters and the fixed safe mapping determine public messages. Provider descriptions and URLs are never echoed. | Parser and malformed API checks passed. All real provider failure messages remain. |
| Maintenance | Database time and committed delete counts determine eligibility, counts, and remaining work. | Cleanup fixture proof passed. Renewal races, interrupted sweeps, and hosted execution remain. |
| Security events | Server UUID, actor class, operation result, and server clock supply operational fields. Success is logged after commit. | Fixed field logging implemented. Inspect actual deployed logs and retention. |

## Acceptance criteria coverage

| Criterion | Evidence | Remaining verification |
| :--- | :--- | :--- |
| AC-1 | Real setup, operator clock, callback checks, repeat setup and recovery data proof | Repeat live setup, cancel and expiry, competing operators, real recovery |
| AC-2 | Real Google proof, identity policy, token suppression, state, closed API | Another real identity, all public errors, real replacement rejection |
| AC-3 | Live session, guarded JSON, signed out API, private page response proof | Second device, seeded other user, deployed storage outage |
| AC-4 | Deferred renewal, absolute and stored expiry limits, persistent cookie attributes, cleanup | Browser restart, real heartbeat and cookie failures, exact boundary interactions |
| AC-5 | Device revocation, idempotent sign out, client intent and draft contract | Real draft copy and cancel, lost responses, second device remains valid |
| AC-6 | Shared lock, state invalidation, recovery deletion rules, intent races | Real global sign out, callback and revocation races across devices |
| AC-7 | Shared verified operator flow and rollback recovery data proof | Actual replacement identity and uncertain commit recovery |
| AC-8 | Permanent sign in and account pages, safe destinations, guarded DTO | Phone layout, keyboard, modal focus, full return flow |
| AC-9 | Visible controller, hidden tab check, same owner guard, captured separate tab destination | Real editor draft retention, focus fallback, reauthentication |
| AC-10 | Input and callback errors, immutable intents, response ordering, cancellation, locked failures | Browser response loss in both cookie states, global reauthentication, interrupted flows |
| AC-11 | Atomic Neon limits, strict boundary validation, lock and rollback proofs | Hosting spoof resistance, outage injection, final cookie and origin checks |
| AC-12 | Bounded cleanup, active record retention, fixed operational event fields | Hosted Cron configuration, overlap and renewal races, deployed log inspection |
| AC-13 | Shared migration, live schema, pure generation and cleanup modules, build | Configuration omission matrix, later task migration integration, hosting compatibility |
| AC-14 | Pinned packages, rollback, policy, state, session, commit ordering, real Google and page privacy proofs | Real two device and browser race cases, recovery, task persistence proof with real resolver |
