# 0002. Private account access

**Date**: 2026-11-03
**Status**: In Progress

## Summary

You sign in to your private dashboard with one verified Google account. A local setup command establishes that account before normal sign in becomes available, and a recovery command can replace its Google identity while preserving your tasks. Your devices remember you for a renewable 30 day window, with a maximum session age of 90 days. Better Auth manages sign in and sessions, using the existing Neon and Drizzle foundation.

## Requirements

**User stories**:

* You can open your private dashboard on your devices without maintaining another password.
* You can end access on one device or every device.
* You can recover access without creating another dashboard user or losing your tasks.

**Acceptance criteria**:

* **AC-1**: A local setup command verifies your Google identity through a browser flow and shows it for explicit confirmation before creating the user and Google binding. It outputs the stable user ID for `PERSONAL_ACCOUNT_ID`. Repeating setup for the same identity returns the same user; another identity cannot silently replace it.
* **AC-2**: Normal sign in accepts only the provisioned Google identity for the configured personal user. Public enrollment, automatic identity linking, other providers, direct client supplied identity tokens, passwords, profile editing, and saved avatars are unavailable.
* **AC-3**: Private pages and application data access require a live database session and the configured personal user ID. Missing or expired sessions receive 401 on JSON interfaces; another authenticated user receives 403. Page redirects do not substitute for checks where data is read or written.
* **AC-4**: Sessions survive browser restarts. Visible authenticated use can renew the 30 day window, at most once per 24 hours. Hidden tabs send no renewal heartbeat. Every session stops authorizing at 90 elapsed days from its original creation, even if activity continues.
* **AC-5**: Sign out this device revokes its session and clears its cookies and local private state after success. The interface first allows unsaved work to be copied or the action canceled. Retrying an already completed device sign out is safe.
* **AC-6**: Sign out all devices requires explicit confirmation, revokes every session for the personal user including the current one, and invalidates outstanding dashboard sign in proofs. A racing callback cannot recreate access from an invalidated proof. Subsequent authorization checks reject revoked sessions.
* **AC-7**: The private recovery command verifies and confirms a replacement Google identity, changes the binding of the same dashboard user, and revokes its sessions and outstanding sign in proofs. It never changes task ownership or task content. Failure before commit leaves the old binding intact; a retry after an uncertain commit does not create another user.
* **AC-8**: The existing theme supports an accessible `/sign-in` page and a private `/account/access` page showing the account email and both sign out actions. Successful sign in returns to a validated local private destination, with `/` as the fallback.
* **AC-9**: Expiry pauses private reads and writes and offers sign in in a separate tab. The original tab retains its unsaved draft in memory. Access resumes only after a fresh server check confirms the same personal user. Authentication signals never carry task content or credentials.
* **AC-10**: Failed or uncertain sign out locks the private view and never reports completion. A known failure preserves any cookie still present, but a lost response may have left it present or cleared. Device retry is safe with either state; uncertain global sign out can require sign in and renewed confirmation. Concurrent tabs cannot clear or downgrade another pending action. Failed, canceled, denied, or interrupted sign in gives a safe next action without exposing which identity is provisioned.
* **AC-11**: Shared sign in attempt limits use atomic Neon counters across server instances. Exact origin checks, secure cookies, bounded inputs, and closed endpoint exposure remain enforced. Missing configuration, failed storage, or failed security checks cannot grant access.
* **AC-12**: Session IP and browser metadata remain only with their session. Revoked sessions are deleted. Expired sessions, temporary proofs, and stale attempt counters are removed by bounded maintenance. Application logs contain operational security events, without identity details, credentials, or private content.
* **AC-13**: Auth schema belongs to the same reviewed Drizzle migration history as application data. Auth runtime, local operator commands, maintenance, and migrations validate only their own configuration. Compatible schema rollback cannot reopen enrollment or change ownership.
* **AC-14**: Before the feature grows beyond its first integration slice, pinned package versions prove the capability matrix below. Before this feature is complete, the real integration also proves setup, renewal, age limits, revocation races, and recovery. The first task persistence proof uses this real session resolver rather than a mock. Initial HTML and React Server Component payloads contain no account details or task content. The client checks pending sign out intents before fetching private content, including after reload. Next.js Cache Components do not cache authorization across requests.

## Decision

**Chosen option**: Closed Google access with verified local provisioning.

Keep Better Auth, Neon Postgres, Drizzle, Node.js 24, `pg`, and Vercel from spec 0001. Use `google-auth-library` only in the local setup and recovery tooling. Normal dashboard OAuth (the exchange proving your Google identity) remains Better Auth's responsibility.

| Concern | Choice |
| :--- | :--- |
| Enrollment | Local operator command only |
| Normal identity | One explicitly bound Google subject, checked separately from email |
| Sessions | Database records, persistent browser cookie, no cookie identity cache |
| Renewal | 30 days from renewal, no more than one renewal per 24 hours |
| Absolute limit | 90 days from original session creation |
| Client refresh | Native fetch, one auth controller per tab, visible heartbeat every 60 seconds |
| Attempt limits | Application owned atomic counters in Neon, no Redis service or library hook dependency |
| Recovery | Local verified Google replacement, same dashboard user ID |
| Security events | Structured operational logs, no permanent activity history screen |

**Implementation skills**:

* `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`)
* `better-auth-security-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-security-best-practices/`)
* `neon-postgres` (`neondatabase/agent-skills`, `.agents/skills/neon-postgres/`)
* `neon-drizzle` (`neondatabase/ai-rules`, `.agents/skills/neon-drizzle/`)
* `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.agents/skills/vercel-react-best-practices/`)

## Rationale

Reasoning, alternatives, and discovery results: [rationale.md](rationale.md).

## Feature design

### Boundaries and integration

This is scope feature 8, a new web FEATURE in a single repository. Delivery uses Tracer Bullet slices and the Alpha workflow. The seven source files contain the theme and starter pages, with no existing auth implementation or account data to migrate.

This spec supplies the prerequisite for `docs/specs/0001-task-data-persistence/index.md`. Preserve its ownership and response contracts. Export the server session resolver from `lib/auth/server.ts`, generate auth schema into `lib/db/schema/auth.ts`, and use the same migration history and database connection modules under `lib/db/`. Task code continues to own its data routes, editor state, and task polling.

Keep the account screens small. The dashboard shell, task table, editor, profiles, device list, public enrollment, additional sign in methods, application MFA, account deletion interface, and Google API integrations are outside this feature. Google controls its own credential and MFA prompts. A new dashboard sign in means another verified Google flow; it does not guarantee that Google asks for a password again.

### Data model

Generate the four library auth tables from the pinned Better Auth configuration and matching schema generator. Define the application owned counter table in Drizzle and include it in the same auth migration. The table below is the logical contract. Keep required library columns even when unused, with nullable fields empty. Review generated changes rather than copying a remembered schema.

| Record | Required fields | Nullable or unused fields | Keys and relationships |
| :--- | :--- | :--- | :--- |
| User | String ID, email, name, email verification state, creation and update times | Image remains null; no added profile fields | ID primary key, email unique; tasks retain their existing owner reference |
| Account | String ID, user ID, provider ID, provider account ID, timestamps required by the generator | Password and provider token fields remain null; optional scope and token expiry fields remain empty | User foreign key; unique provider and account ID pair; at most one Google binding per user |
| Session | String ID, user ID, opaque token, creation time, update time, expiry | IP address and browser information when available | User foreign key; token unique; user and expiry indexes |
| Verification | String ID, identifier, proof value, expiry, other required generator fields | No custom profile or task data | Generator keys and identifier index; used only for Better Auth's temporary OAuth state |
| Rate limit | String ID, unique text key, integer count, bigint last request time in epoch milliseconds | No raw address or identity in the key | Application owned Drizzle table; unique key for an atomic counter; last request index for cleanup |

User to session is one to many. Each account belongs to one user. This release provisions one Google account for that user. Verification and counter records do not grant ownership and need no task relationship.

Use the existing string auth IDs. Setup generates new user and account IDs with the server's cryptographic UUID generator. Google `sub` is the provider account ID, never the dashboard user ID. Add the account uniqueness constraints through reviewed Drizzle migrations if the generator does not supply them.

Email and name come from the verified Google profile. Require a verified email and nonempty name during setup and recovery. Normal sign in may refresh those two fields only after the exact bound Google subject has passed authorization. A changed email never links a different subject or selects another user. Always discard the image.

No Google API access is needed after sign in. Do not request offline access. Do not retain access, refresh, or ID tokens in account columns or cookies; clear those fields through server hooks before persistence. Better Auth's own session token remains in its required protected session record. The browser receives only the library's protected session cookie.

### Local setup and recovery

Provide `npm run auth:setup`, `npm run auth:recover`, and `npm run auth:cleanup`. Run these on your computer with a browser and authorized direct database access. They are separate from the deployed application and never expose a deployed setup route.

Both identity commands use Google's maintained Node client for the code exchange and signed identity token verification. Register the exact local callback `http://127.0.0.1:43871/oauth/google/callback` on the selected Google web OAuth client. Bind the listener only to `127.0.0.1`; if the port is occupied, stop with a clear error. Do not silently choose another redirect address.

Each invocation creates cryptographically random state, nonce, and a PKCE verifier (a temporary secret binding the code exchange to this invocation). Request only `openid email profile`, with account selection. State, nonce, tokens, and the verifier live only in process memory. Check the exact callback path and host, state, code exchange, signature, issuer, audience, expiry, nonce, subject, and verified email before allowing confirmation. Never accept a browser supplied profile as proof. The attempt and confirmation expire after ten minutes; cancel, timeout, invalid state, and verification failure write nothing.

The local callback applies the same query bounds and security parameter validation as the deployed callback below. An invalid callback produces only a generic local error and makes no database change.

Show the database host and database name without credentials, the verified Google email and subject, and the proposed action in the terminal. Require interactive confirmation. Recovery also shows the unchanged dashboard user ID and explains that all sessions will end. Never offer a noninteractive confirmation bypass in these commands.

Only after confirmation, enter the serialized transaction described below:

1. Setup with no auth users creates one user and its Google account together. Existing temporary proofs or counters do not prevent setup. Output `PERSONAL_ACCOUNT_ID=<id>` after commit for you to configure through the deployment settings. Until that setting matches the user, deployed access stays closed.
2. Setup with that same verified binding returns the existing ID without creating records or ending sessions. Another existing identity, multiple users, or ambiguous records cause a refusal directing you to recovery or an explicit data repair.
3. Recovery requires `PERSONAL_ACCOUNT_ID` and the existing user. Replace its Google binding, update its verified name and email, delete all its sessions, and invalidate all OAuth verification records. Keep the user ID and every application row unchanged. Refuse a subject already bound to another user.
4. Repeating recovery for the now current identity safely revokes sessions again and keeps the same user ID. Report completion only after commit. On an uncertain connection result, explain how to rerun; do not assume rollback.

Close the listener and discard tokens on every exit. Output identifiers and confirmation details only where the operator needs them, never connection strings, secrets, codes, tokens, or full request URLs. Setup is not an authenticated dashboard session and issues no dashboard cookie.

### Serialized auth mutations

Use one transaction advisory lock, `8147002001`, for account setup, recovery, sign in start, Google callback processing, session renewal, and both sign out actions. This is a database lock shared by every server instance. Use `pg_try_advisory_xact_lock`, never a session advisory lock through Neon's transaction pool.

For a runtime mutation, bind Better Auth's adapter to the same request scoped Drizzle transaction that holds this lock. All auth user, account, session, and proof writes for that operation must use that transaction. Buffer response headers, cookies, and success events until commit. Do not keep a lock on one connection while library auth writes use another connection. Disable detached auth writes and background mutations on these paths.

The first integration slice starts with the capability proof below. These library integration requirements are not established capabilities until the pinned versions pass it. A failed proof returns this decision to `/architect` before feature implementation continues. Do not silently weaken the contract or substitute another provider, session model, or adapter.

Keep attempt counters outside this transaction so an unsuccessful sign in still consumes its allowance. Complete the wrapper's independent atomic counter operation before starting the auth transaction. Reuse the existing runtime pool and its initial three connections per function instance, with an upper bound of five and the existing Vercel pool lifecycle support. Do not create another auth pool.

Acquire the lock without waiting. Busy returns `409 AUTH_BUSY` on JSON interfaces; the callback uses its safe `busy` redirect below and restarts sign in instead of replaying its single use code. Bound an auth request to 20 seconds, roll back on cancellation or failure, and release connections in all cases. Take the mutation decision time from the database after acquiring the lock.

Recovery and global sign out delete the temporary proofs used by the only enabled OAuth flow. A callback that commits first has its session revoked by the following operation. A callback that follows an invalidation cannot consume the deleted proof. A fresh sign in started after revocation may create a new session normally.

A task request that already passed authorization before revocation commits may finish. Revocation is authoritative at the next authorization check; it does not cancel a previously accepted database operation.

### First integration capability proof

Pin actual Better Auth, schema generator, Drizzle, driver, and Google library versions in the lockfile. Use their installed types and source to identify the APIs used by this proof. The installed guidance and earlier public documentation check do not prove a compatible package combination.

| Capability | Required proof and failure case |
| :--- | :--- |
| Request scoped adapter transaction | Show that account, user, session, and verification writes and their hooks use the exact Drizzle transaction holding the advisory lock. Inject failure after staged writes and prove complete rollback. No detached write may commit later |
| Verified identity in hooks | Obtain the subject and verified email from Better Auth's validated Google result in request scoped context before authorizing profile or session writes. Reject a different subject with the same email, forged input, and missing verified context |
| Database OAuth state and cookie check | Prove ten minute state expiry, the signed state cookie requirement, proof consumption in the locked transaction, rejected replay, and invalidation racing a callback |
| Token suppression | Inspect generated account rows, browser responses, and cookies after successful and failed flows. Google access, refresh, and ID token fields remain empty; the dashboard's own protected session cookie still works |
| Deferred renewal and absolute cap | Prove reads do not renew, the POST does, stored expiry and cookie attributes stop at the 90 day boundary, original creation time stays fixed, and a revoked or expired row cannot be renewed |
| Response and commit ordering | Fail before commit after the library stages success headers. No success or session cookie may escape. Separately lose the response after commit and demonstrate both possible browser cookie states without reporting unconfirmed success |
| Capability isolation and limiter | Resolve an existing session without Google or Cron settings. Prove the wrapper counter is atomic across instances, is consumed before calling the library, and remains committed when auth rolls back |

The proof may use a minimal development sign in surface. Only after all rows pass does the slice extend into the permanent screens and the real two device path. A proof failure is a design stop, not a fallback to a guessed API.

### Session resolution and renewal

`lib/auth/server.ts` exports `requirePersonalSession(headers)`. Its server only return value contains `userId`, `sessionId`, `expiresAt`, and `absoluteExpiresAt`. It throws typed errors using the shared codes below. Page callers may turn unauthenticated into a sign in redirect; API callers return JSON. Database faults never become an ordinary signed out result.

Resolve the signed cookie through Better Auth and read its live session and user records on every application request. Disable cookie identity caching, stateless sessions, and persistent authorization caches. Check the configured user ID and the provisioned Google binding. Use only a request scoped memo for duplicate component reads.

The browser cannot set the user ID, creation time, expiry, or provider binding. For a new session, server hooks set creation and update times from the database clock and expiry to 30 elapsed days later. Original creation time is immutable.

At renewal, use:

* `absoluteExpiresAt = createdAt + 90 elapsed days`.
* `renewAfter = updatedAt + 24 elapsed hours`.
* If renewal is due, `expiresAt = min(databaseNow + 30 elapsed days, absoluteExpiresAt)`, with update time set to `databaseNow`.
* Reject at or after either expiry boundary. A renewal cannot revive an expired or revoked session.

Use Better Auth's deferred renewal behavior so ordinary reads do not extend the cookie. The dedicated renewal POST performs the library renewal in the serialized transaction, clamps its stored expiry, and sends a cookie whose expiry is no later than the committed session expiry. Forward the library's cookie headers only after commit. Repeated renewals before `renewAfter` return the current DTO without extending anything.

Use a persistent cookie with HTTPS Secure, HttpOnly, SameSite Lax, path `/`, and no parent domain sharing. Keep local HTTP development isolated from production cookies. Better Auth owns cookie signing and parsing; do not implement another token format.

### API and page surface

Route Handlers use the Node runtime. Browser requests stay on the exact application origin. The auth wrapper exposes only the protocol paths below; other `/api/auth/*` paths return 404. Do not expose raw session, user update, account linking, account deletion, token access, or password endpoints.

| Surface | Method | Inputs | Outputs | Access and key errors |
| :--- | :--- | :--- | :--- | :--- |
| `/sign-in` | GET | Optional `returnTo: string`; allowlisted reason code | Continue with Google, private access notice, safe retry state | Public shell; valid personal session redirects to validated destination |
| `/account/access` | GET | Session cookie | Generic gated shell; permitted client fetch later supplies account email and actions | Personal session; redirect if signed out, restricted state for 403 |
| `/` and existing application pages | GET | Session cookie | Generic gated shell; private client view loads only when the gate permits it | Private; includes `/design-system`; static assets remain public |
| `/api/auth/sign-in/social` | POST | `provider: "google"`, optional `returnTo: string` | `{ url: string, redirect: true }` | Public, exact Origin and limits; 403, 422, 429, 503 |
| `/api/auth/callback/google` | GET | Bounded Google `code` and `state`, or provider error | Committed session cookie and redirect, safe error redirect, or generic 429 page | Verified library OAuth state and bound identity; denial, expired proof, busy, unavailable |
| `/api/account/session` | GET | Session cookie | SessionDTO in the app JSON envelope | Personal session; 401, 403, 503 |
| `/api/account/session/renew` | POST | Cookie, empty JSON object | SessionDTO and any committed renewal cookie | Personal session, exact Origin; 401, 409 busy, 429, 503 |
| `/api/auth/sign-out` | POST | Cookie, empty JSON object | `{ success: true }` and expired cookies after revocation | Current cookie only; safe if already absent; 409 busy, 429, 503, 504 |
| `/api/account/sign-out-all` | POST | Cookie, `confirmed: true` | `{ signedOut: true }` in the app envelope, expired cookies | Personal session, exact Origin; 401, 409 busy, 422, 503 |
| `/api/internal/auth/cleanup` | GET | `Authorization: Bearer <CRON_SECRET>` | Removal counts by record kind and `remainingEligible: boolean` | Cron bearer only; 401, 503 |

The sign in wrapper accepts no other body fields. It translates `returnTo` into Better Auth's server selected callback destination and error destination. Keep the library's normal authorization code flow and CSRF protection. Explicitly store OAuth state in the verification table, retain its signed browser cookie check, and expire the proof after ten minutes. Disable direct ID token sign in and normal social sign up, and reject runtime user or account creation through database hooks. Disable implicit and explicit account linking.

The verified Google profile hook supplies the trusted subject and verified email to request scoped auth context. Session creation and profile updates compare that subject with the current account binding under the same transaction. Never share mutable request identity through module state. Runtime updates may change only the already bound user's verified name and email and the expected session fields.

SessionDTO is `{ user: { id, email, name }, session: { expiresAt, absoluteExpiresAt, renewAfter }, serverNow }`, with UTC ISO timestamps. It never includes a session ID, token, provider subject, IP address, browser string, or raw account object. The server resolver's session ID stays server only.

Account JSON success uses `{ data, meta: { requestId, serverNow } }`. Errors use `{ error: { code, message }, meta: { requestId, serverNow? } }`. Protocol sign in and device sign out retain the explicitly listed library response shapes; callback responses are redirects. Strip sensitive fields from any internal library session response before producing SessionDTO.

Capture the destination before redirecting. Each private page entry supplies its known pathname, or constructs it from its route parameters, and reconstructs the query from its Next.js `searchParams`, preserving repeated values and omitting the framework's `_rsc` transport parameter. Pass that local path and query as one encoded `returnTo` value on the sign in redirect. No browser supplied forwarding header is the source of the page pathname.

For separate tab reauthentication, capture `window.location.pathname + window.location.search` in the original tab at the user's sign in action. Remove `_rsc`, preserve other query values, and pass the result through the same destination validator before constructing the new tab URL. Do not substitute the sign in tab's URL or an API URL.

Validate `returnTo` on the server at sign in start and before the final redirect. Limit it to 2,048 characters. Parse once against the exact configured origin, require a leading single slash and that same origin, reject control characters, backslashes, credentials, fragments, and decoding errors. Reject paths beginning `//`, `/api`, `/_next`, or `/sign-in`. Permit only registered private application page paths, initially `/`, `/account/access`, and `/design-system`; future private pages extend this one allowlist. Preserve a valid query string. Invalid or unavailable destinations fall back to `/`, never an external URL. Store the validated destination in Better Auth's server controlled OAuth state for the callback.

Use `Cache-Control: private, no-store` for account JSON and auth protocol responses. Private content is not persistently cached. Initial private page HTML and React Server Component payloads contain only generic layout, loading or locked states, and the client gate. Never pass account details, task records, or private server rendered children through that gate in the initial response. Fetch SessionDTO and private records through guarded JSON interfaces only after the browser gate permits them. Apply this to Account access, task surfaces, and private navigation or prefetch responses.

With the existing Cache Components configuration, server authorization reads remain at request time behind Suspense, but successful authorization alone does not cause private content to be serialized. Each private page and each data operation still calls the server guard. A layout check, hidden DOM content, or Proxy check alone is insufficient.

### Client behavior

The sign in page uses the existing theme, one Continue with Google button, and a short notice that access is private. It has pending, canceled, denied, throttled, and unavailable states. Retry starts a new flow. Never echo a provider error description or show the intended owner's email on the public page.

The Account access page displays the email from SessionDTO. Device sign out has a normal button. Global sign out opens an accessible confirmation explaining that the current device is included. Before either action, the shared client auth controller allows the task feature to report an unsaved draft, offers Copy draft and Cancel, and requires deliberate continuation before revocation. Reuse the task controller's draft handling when present; do not build an editor in this feature.

The client gate reads pending sign out records before any SessionDTO read, renewal, private data request, or private view rendering. With no pending record, one auth controller per tab reads session status on startup, focus, visibility return, reconnection, and each 60 second visible heartbeat. Deduplicate in flight requests. Compare the returned `serverNow` with `renewAfter`, rather than trusting the device clock. When renewal is due and the tab is visible, send one renewal POST and accept only a validated success. Hidden tabs pause heartbeats. User initiated server requests remain authorized individually.

Any private request's 401 or 403 immediately pauses data access. Hide the saved private view and retain only the open draft in memory, available through an explicit copy action. A 401 offers a user initiated separate sign in tab with `noopener`, plus Check sign in. Recheck on focus rather than relying on window messages. Resume only for the same confirmed user ID. Read refresh can resume; failed or uncertain task writes still require the explicit Retry required by spec 0001.

After draft handling and confirmation, begin sign out by recording the pending operation, locking private views, and canceling or invalidating in flight private reads. On confirmed success, clear private snapshots, drafts, selections, and cookie derived client state, remove only that operation's intent, then use a full navigation to `/sign-in` so old router content is not reused. Notify other tabs using a BroadcastChannel message containing only an auth changed signal. They must verify their own server session after their pending intent gate permits a read, never trust that signal as proof. Use storage events and focus as the fallback when BroadcastChannel is unavailable.

On a known server failure before commit, keep the view locked, offer Retry, and omit uncommitted cookie deletion headers. Do not deliberately clear a cookie that remains usable for retry. A lost response is different: the browser may already have applied cookie deletion headers even though the client never received a valid success body. Treat its cookie state as unknown; do not promise retention or infer completion from cookie presence or absence.

Keep the pending operation until its own validated success. Device Retry is safe with a remaining cookie, a revoked session, or no cookie, and may return success when its target is already absent. A global Retry requires a live personal session. If it receives 401, keep the intent and offer Google sign in followed by renewed explicit global confirmation. During this recovery, allow only the sign in flow and explicit revocation retries, without fetching SessionDTO or private content. A new session or an auth changed signal alone never clears the intent. Do not unlock from a late read that began before sign out.

Persist one immutable intent per operation in localStorage at `synzspace.auth.pending-sign-out.<operationId>`, where `operationId` is a cryptographic UUID generated once by the initiating tab. Its JSON value is only `{ scope: "device" | "all" }`. Retry reuses the same operation ID and scope; it never creates another record or downgrades an existing one. No record contains an account, session, token, timestamp, or draft.

Writing or deleting one key is the atomic coordination unit. Tabs never update a shared aggregate flag. The gate enumerates all intent keys on startup, storage events, focus, and before starting a private client request. Any pending record keeps it locked, and any `all` record makes global revocation the effective pending scope. A completion handler captures its own operation ID and may remove only that exact key after validating the corresponding server success. It cannot clear another key, even if its action had a broader scope. This prevents an older device completion from erasing a later global intent. Other pending operations remain available to retry, with global records first and lexical operation ID order within a scope. Only one attempt per operation may be in flight in a tab.

Treat an unreadable intent value conservatively as `all`, and require the same explicit global retry and success before deleting its key. Intents do not expire automatically. If a new record appears during an already authorized read, invalidate that read's generation and discard its response; it cannot unlock or render private data. Recheck the intent set before applying any private response.

These records are UI state, never server authorization. If storage is unavailable, keep the generic locked shell, retain any current intent in memory, and offer explicit revocation actions and a storage Retry. Explain that browser storage must become available before the dashboard can open. Do not fetch private content or claim a durable lock that survives a reload without readable storage.

Use English, responsive desktop and phone layouts, labeled controls, keyboard operation, visible focus, accessible pending and error announcements, and a modal with focus restoration for global confirmation. No new illustrations or external image assets are needed. Set private page metadata to prevent indexing; this is not a public marketing or SEO feature.

### Security and failure rules

All browser POST requests require JSON and the exact configured Origin, including device sign out. Callback GET is the deliberate exception to browser Origin requirements; it requires the library's signed state cookie, valid stored proof, and Google verification instead. Keep Better Auth origin and CSRF checks enabled. Use no wildcard origins, shared cookies, or development bypass on production.

Limit JSON bodies to 16 KiB of actual bytes and reject unknown fields. Return 400 for invalid JSON, 413 for oversized input, 415 for non JSON writes, and 422 for invalid fields or missing confirmation. Allow only the documented methods and return 405 with Allow where applicable. Use the existing `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `VALIDATION_FAILED`, `METHOD_NOT_ALLOWED`, and `INTERNAL_ERROR` codes from spec 0001 for these shared cases.

Bound the callback's raw encoded query to 8,192 UTF8 bytes before parsing. After strict percent and UTF8 decoding, limit `code` to 4,096 bytes, `state` to 2,048 bytes, `error` to 128 bytes, and `error_description` to 1,024 bytes. Reject malformed encoding and duplicate decoded `code`, `state`, `error`, or `error_description` keys. A success callback needs one nonempty code and state and no error; a provider failure needs one error and state and no code. Other provider parameters may be ignored within the total bound. Never follow or echo `error_uri` or provider descriptions.

Malformed or oversized callbacks do not call Google or mutate auth records. Redirect to `/sign-in?reason=failed` without copying callback values. For a well formed flow, map `access_denied` to `canceled`, an unbound identity to `denied`, invalid or expired proofs and unknown errors to `failed`, lock contention to `busy`, and provider or configuration unavailability to `unavailable`. Allow only these reason codes plus `throttled` on the sign in page; ignore other reason values. Reuse a return destination only when it came from validated stored flow state; otherwise use `/`.

Apply the following fixed window counters, using database time:

| Rule | Limit per resolved client address |
| :--- | :--- |
| Sign in start | 10 per 60 seconds |
| Google callback | 20 per 60 seconds |
| Session read, renewal, or sign out action, each route separately | 120 per 60 seconds |

The application wrapper owns the atomic counter service for every listed protocol and account route. Consume exactly once after cheap input and origin validation and before invoking Better Auth or opening its mutation transaction. Do not depend on a library custom storage hook or separate get and set calls. Disable the library's process memory limiter on these wrapped paths to avoid a second, inconsistent policy; no unwrapped public auth handler may be exposed.

Commit the counter independently of an auth transaction. Check and increment in one SQL operation, with conflict safe insertion; a rejected attempt cannot reset its window. Canonicalize IPv4 and IPv4 mapped addresses to the same IPv4 value, and group IPv6 by its normalized /64 prefix. Derive the stored key from the rule, fixed window start, and an HMAC of the canonical address using the auth secret. Keys do not store raw addresses. Take the client address from the Vercel adapter using the pinned `@vercel/functions` IP helper, not arbitrary browser supplied forwarding headers. Verify spoof resistance on the deployed platform. Local development uses the loopback address; an unavailable address uses one shared unknown bucket.

Return 429 with `Retry-After` set to the positive whole number of seconds remaining until the database window end, rounded up. A throttled callback returns a generic 429 HTML page with that header and a link to `/sign-in?reason=throttled`, without reflecting callback inputs. Other listed callback failures use the safe redirects above. The auth controller can count down from the header but makes no automatic sign in or sign out replay. An unavailable counter store returns 503 on JSON interfaces and the safe unavailable callback redirect, before the protected operation, rather than falling back to process memory.

| Error | Next action |
| :--- | :--- |
| 401 `UNAUTHENTICATED` | Pause access, preserve the open draft, offer separate tab sign in |
| 403 `PERSONAL_ACCOUNT_REQUIRED` | Stop private access; show no account or task details |
| 403 `ORIGIN_FORBIDDEN` | Stop the request and correct the origin or client |
| 409 `AUTH_BUSY` | Retry an explicit operation; restart a callback through sign in |
| 429 `RATE_LIMITED` | Wait for the returned retry delay |
| 503 `CONFIGURATION_REQUIRED` | Configure the affected capability, without exposing values |
| 503 `STORAGE_UNAVAILABLE` | Retain safe local state; sign out stays locked and unconfirmed |
| 503 `PROVIDER_UNAVAILABLE` | Start a new sign in when Google is available |
| 504 `REQUEST_TIMEOUT` | Treat mutation outcome as uncertain and use its defined retry |

Existing valid database sessions continue to work during a Google outage. New sign in and identity recovery require Google. Google account revocation does not instantly revoke an independent dashboard session; the dashboard's own global sign out or recovery command supplies that control.

Device sign out can remove only the session identified by its verified cookie, including an already unusable cookie. It grants no private read access. Global sign out, renewal, session reads, and private pages require the configured personal user.

### Configuration, retention, and operations

| Setting | Source and purpose |
| :--- | :--- |
| `DATABASE_URL` | Pooled Neon connection for application queries and runtime auth |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations and local operator commands, outside the deployed runtime where practical |
| `BETTER_AUTH_SECRET` | Strong random auth secret from the secret setup flow, at least 32 characters; never a default value |
| `BETTER_AUTH_URL` | Exact application origin; HTTPS in production, explicit local HTTP origin in development |
| `PERSONAL_ACCOUNT_ID` | The committed user ID output by setup; preserved during recovery |
| `GOOGLE_CLIENT_ID` | Google Cloud web OAuth client selected for that environment |
| `GOOGLE_CLIENT_SECRET` | Its secret, delivered through the secret setup flow |
| `CRON_SECRET` | Independent bearer secret for internal maintenance, shared with the existing task maintenance capability |

Use separate Google clients for development and production. Each registers its exact application callback and the fixed loopback operator callback. Set up Google's consent screen for the intended personal account and only the three identity scopes. Keep the production client configuration stable across devices. Do not configure broad development or preview callback wildcards.

Validate variables by capability:

* Session and application data checks need database URL, auth secret, application URL, and personal user ID. They do not require Google credentials or Cron settings.
* Sign in needs those settings plus both Google credentials. Before provisioning or personal ID configuration, it returns a generic unavailable state and cannot enroll anybody.
* Local setup needs the direct URL and Google client credentials. Recovery additionally needs the configured user ID. Neither issues a cookie or requires the runtime auth secret.
* Auth schema generation uses explicit generation settings and pure schema definitions, without opening runtime connections or requiring a personal user ID. Migration uses only the direct URL.
* Maintenance needs only runtime database URL and Cron secret. Its pure auth table cleanup module imports no auth instance, session resolver, Google configuration, or personal account configuration.

The first build slice records exact compatible dependency and generator versions in the lockfile and completes the capability proof. This feature owns the first reviewed migration in the shared Drizzle history, containing the auth tables and application owned counter table. Spec 0001 then owns a subsequent migration adding tasks and creation receipts, followed by its later tag and comment migration. Reuse existing auth schema, history, and pool; do not generate auth DDL again in the task slice. Test on a development branch first; do not migrate on ordinary requests or use production schema push. Rollback keeps compatible tables and the closed enrollment configuration.

Delete revoked session rows in their revocation transaction. Configure a daily Vercel Cron request to `/api/internal/auth/cleanup` at `0 3 * * *` UTC. Keep the task cleanup route and its `0 2 * * *` schedule unchanged. Check the selected hosting plan's actual schedule allowance during deployment setup; do not claim an unlimited free allowance.

Maintenance deletes sessions past stored expiry or the 90 day limit, expired verification records, and counters whose last request is more than 24 hours old. Use database time, indexes, and batches of at most 100 per record kind, stopping before a 20 second request deadline. Recheck eligibility when deleting; do not delete a session concurrently renewed into validity. Overlapping runs are safe. Report counts and remaining eligible work, without exposing record identifiers. Cleanup delay never extends authorization. An outage or backlog can delay physical deletion until a later successful sweep. The local cleanup command uses the same eligibility rules and bounded batches for deliberate maintenance.

Log access control events for session creation, local and global revocation, setup, recovery, denial, throttling, and maintenance. Include event name, request ID, UTC time, actor class (operator, personal owner, or anonymous), result code, elapsed time, and affected count where relevant. Emit mutation success only after commit. Do not log names, email, Google subject, IP, browser string, tokens, cookies, codes, state, request bodies, database URLs, or secrets. Use the host's existing log retention, with no additional permanent history store or monitoring service.

### Value sourcing

| Action | Value produced or displayed | Source |
| :--- | :--- | :--- |
| Setup and recovery | Verified identity and confirmation label | Google's verified ID token claims: `sub`, `email`, `email_verified`, `name`; expected client and nonce from this command |
| First setup | Dashboard user and account IDs | Server cryptographic UUID generation inside the confirmed provisioning transaction |
| Repeated setup and recovery | Existing owner and binding | Auth user and account rows, with recovery pinned to `PERSONAL_ACCOUNT_ID` |
| Authorize a request | User ID, session ID, expiry, eligibility | Better Auth verified cookie and live database session, user, and Google binding |
| Renew a session | Sliding expiry, absolute expiry, next renewal | Database clock, immutable session creation time, stored update time, 30 day, 90 day, and 24 hour constants above |
| Account page | Email and name | The permitted user fields in SessionDTO, from the bound verified profile |
| Redirect a private page | Original local destination | Page entry pathname or route parameters, plus reconstructed Next.js `searchParams` without `_rsc` |
| Open a separate sign in tab | Original local destination | The original tab's `window.location.pathname + window.location.search` at the user's action, without `_rsc` |
| Return after sign in | Destination | Server validated captured `returnTo`, stored inside Better Auth's OAuth state and validated again at callback; `/` fallback |
| Device sign out | Session to revoke | Verified current cookie only, never a request supplied token or user ID |
| Global sign out | Target user and confirmation | Live personal session plus `confirmed: true`; all its session rows and the enabled flow's proof records |
| Resume a draft | Same account check | Original confirmed user ID in the open controller, compared with a newly fetched SessionDTO |
| Retry sign out | Operation ID and scope | Its unique localStorage key and immutable scope record; UUID comes from the initiating tab's cryptographic generator |
| Gate private content | Effective pending scope | Enumerated intent records, with `all` taking precedence; an empty intent set permits a fresh server session check |
| Throttle | Key, allowance, retry delay | Platform resolved address, database fixed window time, rule constants, independent atomic counter result; rounded up remaining seconds in `Retry-After` |
| Callback error page or redirect | Safe reason | Bounded decoded security parameters and the fixed reason mapping above, never raw provider descriptions |
| Maintenance | Eligibility and removal counts | Database clock, record expiry or last request time, committed delete counts |
| Security event | Request ID, actor class, result, time | Server generated UUID, authenticated or operator context, operation result, server clock |

### State transitions

| State | Action or event | Result |
| :--- | :--- | :--- |
| Unprovisioned | Confirm local verified setup | One bound user exists; app remains closed until its ID is configured |
| Signed out | Start Google flow | Temporary proof, then callback verification |
| Signing in | Bound verified identity and committed session | Signed in, redirected to validated destination |
| Signing in | Cancel, wrong identity, invalid proof, or failure | Signed out with safe retry; no usable new session |
| Signed in | Due visible renewal before both expiry limits | Same session, expiry clamped to the absolute limit |
| Signed in | Expiry or revoked session observed | Private access paused, draft retained, separate tab sign in offered |
| Signed in | Begin either sign out | Private view locked, old reads invalidated |
| Signing out | Commit and confirmed response | Cookies and local private state cleared |
| Signing out | Failure or lost response | Locked, unconfirmed, explicit Retry |
| Bound account | Confirm verified recovery | Same user, replacement binding, sessions and pending proofs invalidated |

### Critical test scenarios

| Scenario | Criteria |
| :--- | :--- |
| Fresh setup, repeat setup, cancel confirmation, wrong local state, port conflict, and two racing setup commands | AC-1, AC-7, AC-11 |
| Configure the output user ID, complete Google sign in, reload, and sign in on a second device | AC-1, AC-2, AC-3, AC-4, AC-14 |
| Reject another Google subject even with matching email, public sign up, direct ID token input, linking, and forged owner input | AC-2, AC-3, AC-11 |
| Read private pages and JSON while signed out, with another seeded user, with a revoked token, and during database failure | AC-3, AC-11, AC-14 |
| Seed development session timestamps around renewal, inactivity expiry, and the exact 90 day boundary; ensure cookie expiry is also clamped | AC-4, AC-14 |
| Keep a visible idle tab open, hide it, restart the browser, return focus, and deny cookie writes during renewal | AC-4, AC-9, AC-10 |
| Copy or cancel before sign out, revoke one device, retry its lost response, and confirm another device remains valid | AC-5, AC-10 |
| Confirm global sign out while another tab and device are active; race callbacks on both sides of the invalidation | AC-6, AC-10, AC-14 |
| Lose sign out response bodies after cookie headers have or have not been applied; retry device sign out in either state, and require sign in and reconfirmation for an unauthenticated global retry | AC-5, AC-6, AC-10 |
| Reload and prefetch Account access and task pages with a valid cookie and pending intent; inspect HTML and React Server Component payloads for private content and ensure no private JSON request starts | AC-8, AC-10, AC-14 |
| Race device and global intents from two tabs, finish the older operation last, and prove only its own key is removed; retry multiple intents without scope downgrade | AC-6, AC-10 |
| Block browser storage or corrupt an intent value; keep the generic view locked and provide safe revocation and retry | AC-10, AC-11 |
| Recover to a new verified Google account, inspect unchanged task ownership, reject the old identity, and race recovery with callback or renewal | AC-7, AC-14 |
| Interrupt recovery before commit and after uncertain commit, then rerun without duplicate users or partial binding changes | AC-1, AC-7, AC-13 |
| Capture a private page path and repeated query values on direct redirect and separate tab sign in; return to that page, strip `_rsc`, and exercise invalid or missing destination fallback | AC-8, AC-9, AC-11 |
| Exercise callback byte boundaries, malformed escapes, duplicate security keys, conflicting success and error inputs, throttling, and every safe reason mapping without reflection | AC-2, AC-10, AC-11 |
| Exercise the two pages with keyboard and phone layouts | AC-8 |
| Expire a session with an unsaved draft, sign in in a separate tab, use the focus fallback, and retain an uncertain task write for explicit Retry | AC-9, AC-10 |
| Reject concurrent attempts across two server instances at the exact counter boundary, and simulate counter storage failure | AC-11 |
| Spoof forwarding headers on the real host, inspect cookie flags, inspect all JSON for token leakage, and inspect security logs for content | AC-2, AC-11, AC-12 |
| Clean expired records while a session renews; interrupt and overlap sweeps; prove active sessions survive and delayed cleanup cannot extend access | AC-4, AC-12 |
| Omit Google settings during valid task access, omit runtime settings during migration, omit Cron settings during ordinary access, and build with Cache Components | AC-3, AC-13, AC-14 |
| Complete every row of the capability matrix with actual pinned package APIs; fail the transaction after staged cookies, prove rollback, and keep counter consumption committed | AC-6, AC-7, AC-11, AC-14 |
| Apply the auth migration once, then the task and receipt migration, then tags and comments on the same development history; reject duplicate auth generation | AC-13 |

## Build plan

The recommendation is to complete these five slices in order. Each proves a real path through the affected layers. The auth feature can provide its session prerequisite before the full task UI exists.

1. **Prove closed Google access through the full stack.** Start by pinning the libraries and schema generator. This slice owns the shared history's first migration for auth and counters; generate it and apply it on an isolated development branch to run every capability proof. Establish the application wrapper's independent atomic limiter at the first public boundary. Only after the matrix passes, extend the slice into local verified setup, the guarded callback, a minimal sign in page, and a generic protected home using the real resolver and client gate. Prove one allowed Google identity on two devices, a rejected identity, and rollback with no escaped cookie. Return an unsupported capability to architecture before extending the feature or promoting the migration to production. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-11**, **AC-13**, **AC-14**.
2. **Complete remembered device access and reauthentication.** Add the minimal session DTO, deferred renewal POST, visible auth controller, clamped expiry, generic Cache Components shell and client fetch gate, captured and validated return destinations, separate tab reauthentication, and the task controller integration contract. Prove the three time boundaries and preserved drafts. Satisfies **AC-3**, **AC-4**, **AC-8**, **AC-9**, **AC-14**.
3. **Complete device and global sign out.** Build gated Account access, draft guards, global confirmation, serialized revocation and proof invalidation, immutable UUID intent records, cross tab signals, read generation invalidation, and locked failure recovery. Prove both cookie states after response loss, reload and stream privacy, overlapping tab operations, and callback races without claiming unconfirmed completion. Satisfies **AC-5**, **AC-6**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-14**.
4. **Prove account recovery through the same identity boundary.** Add verified local replacement, atomic binding and metadata changes, session and proof revocation, idempotent command retry, and credential free audit events. Prove the user ID remains unchanged, and inspect existing task ownership when the task foundation is available. Recovery does not require the task UI or create application tables. Satisfies **AC-1**, **AC-2**, **AC-6**, **AC-7**, **AC-10**, **AC-12**, **AC-14**.
5. **Close maintenance and operational verification.** Add bounded authenticated cleanup and the local cleanup command, capability scoped configuration, migration compatibility checks, final accessible states, and security event verification. Run lint and production build, then `/check verify private account access` against every criterion with the development database and real Google flow. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**.

## Consequences

**Positive**:

* Your task ownership stays stable when Google access must be replaced.
* Enrollment stays closed and the application needs no password or email delivery system.
* Live session checks give revocation a single authoritative place.

**Tradeoffs**:

* You operate Google client settings and a local recovery tool, and must retain authorized database and deployment access.
* Callback transactions hold a database connection during provider verification. They have short deadlines and serialized contention is acceptable for one owner.
* Visible heartbeats and live session checks consume function requests and database activity. Free tier suitability depends on use.
* Physical cleanup depends on successful maintenance. Expired records can remain until a later sweep, without retaining access.
* Lost sign out responses can require a new sign in before repeating global revocation.
* Private records load after the browser intent gate, so an initial page response cannot contain the account or task view. Unavailable browser storage keeps that view locked until storage recovers.
* Concurrent sign out actions can leave several independent intents. Each needs its own confirmed completion rather than being silently dismissed by another operation.
* An already authorized task request may finish after revocation, and a Google account change alone does not revoke dashboard sessions.

**Neutral**:

* No application code is changed by this design.
* The Alpha workflow calls for real app verification after implementation, without a separate mandatory automated suite or model code review.

## Follow-up

* [ ] Capture `better-auth-best-practices` conventions in `lib/auth/AGENTS.md`, with a short root pointer.
* [ ] Capture `better-auth-security-best-practices` conventions in the same auth area.
* [ ] Capture the `neon-postgres` connection and transaction pooling rules in root `AGENTS.md`.
* [ ] Capture the `neon-drizzle` shared schema and migration rules in root `AGENTS.md`.
* [ ] Capture the `vercel-react-best-practices` rendering and serialization rules in root `AGENTS.md`.
* [ ] Keep additional skills uninstalled for now and MCP connections deferred. The candidate inventory remains in the rationale.
* [ ] Let the dashboard shell link to Account access when its own feature is built.
