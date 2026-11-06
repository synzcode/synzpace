# Verify: task data and persistence · spec 0001 · updated 2026-11-06

_Steps derived from spec 0001 acceptance criteria and value sourcing. `/check verify` can use this checklist. Checked commands record observed results, rather than claiming every criterion is complete._

## Current evidence

Both application migrations are applied to the development database. The schema, committed storage, validators, transaction races, client controllers, and signed out HTTP checks passed during `/develop`. The production build, TypeScript, and lint passed.

After you signed in locally again, `npm run tasks:prove-api` passed with an existing real Google session and the live Better Auth session resolver. It created, read, replayed, and edited a task, rejected a stale revision with the latest saved record, and rejected signed out access, a foreign Origin, forged fields, unsupported media, oversized input, and invalid JSON. The proof removed its temporary task and receipt afterward. It did not revoke your session.

The real device sign in proof belongs to spec 0002 and has passed. A task created or edited on one physical device has not yet been read on the other. These task changes are local and have not been pushed or deployed. Final task screens belong to later features; the interfaces here are routes and reusable controllers.

## Commands

You can run these from the project root against the development database using the ignored `.env.local`. Database proof scripts require `AUTH_PROOF_DEVELOPMENT=true`, except the schema probe. The API proof additionally needs an active real Google session. Proofs remove their own fixtures. The contract proof invokes real cleanup, which can also purge other already expired tasks in that development database.

* [x] `npm run tasks:prove-schema` confirms task and receipt columns, defaults, bounds, receipt survival after task deletion, and the account cascade. Its changes roll back. AC-2, AC-3, AC-10, AC-13.
* [x] `npm run tasks:prove-task-thread` confirms committed create and read, normalized creation replay, changed payload rejection, bounded cursor pages, dataset bound cursors, racing revisions, owner isolation, and receipt survival after permanent deletion. AC-2, AC-3, AC-9, AC-10, AC-11, AC-14.
* [x] `npm run tasks:prove-contract` confirms the expanded live schema, Unicode folding, canonical rich text, calendar dates, status no ops, assignments, comments and replay, independent tag revisions, revision exhaustion rollback, trash and restore, expiry after a parent lock wait, child expiry guards, cleanup cascades, and retained receipts. AC-2 through AC-6, AC-9 through AC-14.
* [x] `npm run tasks:prove-client` confirms the 750 millisecond debounce, preservation of newer typing, rejection of an earlier poll after a save, exact uncertain request retry, conflict review and reapplication, stable creation keys, and hidden polling. AC-7, AC-8, AC-9, AC-10, AC-14.
* [x] `npm run tasks:prove-api` confirms the real session task path and input checks described above. AC-1, AC-2, AC-3, AC-9, AC-10, AC-13, AC-14.
* [x] `npm run build`, `npx tsc --noEmit`, and `npm run lint` pass with the implemented routes and controllers. AC-13.

## Remaining application and operational checks

* [ ] After deploying compatible code and schema, use the same approved account on laptop and phone. Create a task on one, read it on the other, edit it, and confirm a reload retains the committed fields. AC-1, AC-2, AC-3, AC-13.
* [ ] Exercise every tag, comment, assignment, restore, and permanent deletion route through real authenticated requests. Signed out and other user requests must expose no records. AC-1, AC-5, AC-6, AC-11.
* [ ] Display an active task resource in two browser sessions. Confirm refresh within three seconds plus latency, focus and reconnection refresh, hidden polling pause, and no overlapping reads. Dirty drafts must survive remote changes and auth expiry. AC-7, AC-8, AC-9, AC-14.
* [ ] Exercise read backoff at 3, 6, 12, and 30 seconds; malformed successes; lost write responses; multiple displayed list and detail resources; and tag label changes during a dirty task and a dirty tag rename. AC-5, AC-7, AC-8, AC-9, AC-14.
* [ ] Exercise copy with clipboard denied, its selectable text fallback, leaving warnings, and confirmed sign out clearing private memory. No draft enters persistent browser storage. AC-14.
* [ ] Exercise all allowed document structures and rejection boundaries, including node count, depth, byte size, unknown keys, unsafe links, invalid Unicode, and unsupported stored versions. Unsupported descriptions remain unchanged while other task fields can change. AC-3, AC-4, AC-13.
* [ ] Race creation with matching keys, trash with comment creation, assignment with tag deletion, restore with cleanup, and overlapping or interrupted cleanup batches. Only committed counts are reported and expired content never escapes. AC-5, AC-6, AC-9, AC-10, AC-11, AC-12.
* [ ] Apply auth, task, and relation migrations in order on a fresh isolated development branch. Reject duplicate auth DDL, simulate migration failure, and run compatible older application code against the expanded schema. AC-2, AC-13.
* [ ] Omit Cron and migration settings during real task access. Omit auth, Google, and personal account settings during task cleanup. Check missing configuration, unavailable storage, timeout, and every stable error mapping without exposing content. AC-1, AC-13, AC-14.
* [ ] Configure `CRON_SECRET` privately on the deployed environment. Missing or wrong bearer authorization must do no work; the authorized daily `0 2 * * *` UTC invocation must report purge counts and remaining work. Preserve the auth schedule and confirm the hosting plan supports both. AC-12, AC-13, AC-14.
* [ ] Inspect deployed logs for operational metadata only, with no task text, credentials, identity details, fingerprints, or connection strings. AC-14.

## Value sourcing checks

Each row supplies a concrete follow up for one row of the governing spec. Command evidence above covers parts of these steps. These boxes remain open for the complete application verification pass.

| Check | Step and expected source | Criteria |
| :--- | :--- | :--- |
| [ ] Authorize any request | Change the session between absent, valid owner, revoked, and another user. Only the live database session matching server `PERSONAL_ACCOUNT_ID` authorizes access. | AC-1 |
| [ ] Create any application record | Create a task, tag, and comment. Inspect server UUIDs, revision 1, and timestamps from the database rather than submitted values. | AC-2 |
| [ ] Create task | Submit a trimmed title. Expect progress 0 and null description, due date, and trash time; forged initial fields are rejected. | AC-2, AC-3 |
| [ ] Edit task | Vary status and progress separately, including selecting the current status. Expect the specified mapping, preserved progress for a status no op, and rejection of both intents together. | AC-3 |
| [ ] Save or reject stale edit | Race two edits with one expected revision. Exactly one changes the record; the stale request returns the latest accessible DTO. | AC-9 |
| [ ] Display a description | Read format 1 and an unsupported stored format. The shared validator controls format 1; the unknown format remains intact while unrelated fields can change. | AC-4, AC-13 |
| [ ] Display due and overdue | Change device timezone near midnight. Due dates remain calendar strings; overdue uses the current device calendar day and excludes completed tasks. | AC-3 |
| [ ] Display timestamps | Read created, updated, and trash instants. Responses are UTC; expiry is trash time plus exactly 720 hours. Later screen formatting uses the device timezone. | AC-2, AC-11, AC-12 |
| [ ] Display tags | Assign tags, rename one, and read the task. IDs and labels come from same owner assignments joined to current tag records. | AC-5 |
| [ ] Display tags in the initial release | Check the task only migration phase with the corresponding older code: tags are explicitly empty without querying future tables. Expanded code queries real relation tables and fails closed if they are missing. | AC-2, AC-13 |
| [ ] Refresh a renamed tag label | Rename a tag remotely while a task draft is dirty. The tag revision updates its label without changing the task base or creating a false task conflict. | AC-5, AC-8, AC-9 |
| [ ] Normalize or reject tag | Compare spaces, case, width variants, composed text, and Straße versus STRASSE. The shared Unicode 15.1 normalizer and database unique constraint determine duplicates. | AC-5 |
| [ ] Add or edit comment | Vary body whitespace and line breaks. The path selects the parent; creation time and ID determine stable order; edits update only the comment revision and update time. | AC-6 |
| [ ] Retry creation | Lose a response and retry the retained key and normalized payload. Expect the current resource, a reused key error for changed content, or CREATION_GONE after deletion or expiry. | AC-10 |
| [ ] Show trash eligibility | Change client time and cross expiry while waiting for a parent lock. Database time and the stored trash instant control eligibility, with no expired latest payload. | AC-11, AC-12 |
| [ ] Refresh displayed data | Change the active page cursor and selected task independently. Only displayed owner scoped resources poll; page replacement never overwrites the selected draft. | AC-8, AC-14 |
| [ ] Accept a read after a write | Finish a save before an earlier poll, then return an older list record. Generation, read sequence, and shared entity revision floors reject obsolete data. | AC-7, AC-8, AC-9 |
| [ ] Handle unsaved work | Type during a save, fail it, and retry. The in memory base, draft, submitted snapshot, and successful response determine feedback; matching poll values alone do not acknowledge the write. | AC-7, AC-9, AC-14 |
| [ ] Cleanup | Run authorized cleanup with an expired backlog and overlapping calls. Database eligibility, committed batches, and the remaining existence query determine counts and backlog. | AC-12 |
| [ ] Paginate | Traverse equal timestamp ties, rename tags across a cursor boundary, and delete a current page. Cursors use the returned last ordering values and dataset; an empty current page returns to the start. | AC-14 |
| [ ] Explain an error | Exercise each shared error code. Validator fields and server generated request IDs supply recovery information, with latest records only where permitted and no database exceptions. | AC-9, AC-13, AC-14 |

## Acceptance criteria coverage

| Criterion | Recorded command evidence | Remaining verification |
| :--- | :--- | :--- |
| AC-1 | Real task session API, signed out HTTP rejection, owner isolation | Other user and child route matrix, deployment checks |
| AC-2 | Live schema, defaults, committed task storage, relations | Real task flow across physical devices and full timestamp checks |
| AC-3 | Title boundary, calendar date, progress and status checks | Full range boundaries and device timezone display |
| AC-4 | Canonical rich text and invalid structure or link rejection | Full size and depth boundaries, unsupported stored format compatibility |
| AC-5 | Unicode duplicates, assignment, rename, delete, revision rollback | Full UI presentation and concurrent assignment matrix |
| AC-6 | Comment creation, replay, order, and trash protection | Full edit and delete API matrix and stable timestamp ties |
| AC-7 | Debounce, newer typing, failed write pause and retry | Real displayed controller interactions and full save feedback |
| AC-8 | Hidden polling and stale read protection | Real visible interval, focus, reconnect, shared resources, and backoff |
| AC-9 | Atomic revision race, real API conflict, client reapplication | Broader browser and child mutation races |
| AC-10 | Creation replay, changed payload, deleted replay, exact client retry | Concurrent duplicate keys and lost response matrix |
| AC-11 | Trash, restore, child protection, permanent deletion | Real device recovery and broader lifecycle races |
| AC-12 | Expiry after lock wait, cleanup, cascades, receipt retention | Hosted Cron, overlap, interruption, and bounded backlog |
| AC-13 | Applied incremental schema, build, private failures | Isolated migration failure and rollback, configuration matrix, deployment |
| AC-14 | Bounded pages, dataset cursors, input and error checks | Copy fallback, leaving guard, complete errors, and deployed log review |
