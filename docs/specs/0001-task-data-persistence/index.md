# 0001. Task data and persistence

**Date**: 2026-11-03
**Status**: In Progress

## Summary

Your tasks, tags, and comments belong to your private account and are saved in Neon Postgres. Better Auth supplies your identity, and Drizzle manages database access and migrations. Task edits save after a short pause, and open devices refresh every three seconds. Failed or conflicting saves preserve your draft, and deleted tasks remain recoverable for 30 days.

## Requirements

**User stories**:

* As the personal account owner, you can retrieve your saved work on another device.
* You can edit without silently losing your draft or overwriting a newer saved version.
* You can recover a trashed task during its retention window and permanently remove it when intended.

**Acceptance criteria**:

* **AC-1**: Every user facing application data request requires a valid Better Auth session for the configured personal user. Signed out callers and other users cannot read or change tasks, tags, comments, assignments, or receipts.
* **AC-2**: Records use the ownership, identifiers, required fields, relationships, timestamps, and revisions defined below. A committed create or edit survives a reload and can be read from a second authenticated device.
* **AC-3**: A task requires a title of 1 to 200 characters. Progress is an integer from 0 to 100. Status and progress follow the agreed mapping. Optional due dates remain calendar dates across devices.
* **AC-4**: Optional descriptions preserve the permitted Tiptap rich text as validated, versioned JSON. Unsupported nodes, unsafe links, invalid structure, and oversized documents are rejected without replacing saved content.
* **AC-5**: Account owned tags can be created, renamed, deleted, assigned to multiple tasks, and removed from tasks. Names ignore case and surrounding spaces for uniqueness. Deleting a tag removes its assignments from active and trashed tasks without deleting those tasks.
* **AC-6**: Personal comments can be explicitly added, edited, and deleted. They require nonempty plain text, retain creation and update timestamps, and are listed in creation order with stable ties.
* **AC-7**: A valid task edit starts saving after 750 milliseconds without another edit. The client distinguishes unsaved, saving, saved, invalid, failed, and conflicting states. Only a successful response acknowledges a save. A failed write pauses further automatic writes for that record until explicit Retry.
* **AC-8**: A visible task surface refreshes its displayed saved data every three seconds, without overlapping reads. Focus and reconnection trigger an immediate refresh. Hidden tabs pause polling. Incoming data never replaces a dirty draft.
* **AC-9**: Concurrent changes use an atomic revision check. A stale mutation changes nothing and returns the latest accessible record. The client preserves the draft, pauses autosave, and supports deliberate review and reapplication against the latest revision.
* **AC-10**: Retrying a creation request with the same key and payload never creates another resource, including after the original resource has been permanently deleted. Creation receipts and resources commit together. Other mutations are safe to retry without repeating an unintended state transition.
* **AC-11**: Trashing a task hides it from normal results and preserves its comments and remaining tag assignments. It is read only in trash. Before 30 elapsed days, it can be restored or permanently deleted through a separate confirmed action. Restore preserves its task fields and surviving child records.
* **AC-12**: At 30 elapsed days, a trashed task is no longer recoverable or readable through task APIs. An authenticated daily job permanently removes eligible tasks, their comments, and their assignments. Repeated or overlapping cleanup runs are safe. Reusable tags and creation receipts remain.
* **AC-13**: Database and description format changes use the migration and compatibility rules below. Missing configuration, database failures, and unsupported description formats cannot grant access or cause a silent destructive replacement.
* **AC-14**: Lists are bounded and paginated. Errors give the caller a defined next action. Unsaved drafts stay only in the open tab, with a leaving warning and a copy option. Logs contain operational metadata rather than task or authentication content.

These criteria govern the shared storage, API, and client data controller. The final dashboard, task table, editor toolbar, tag controls, search controls, and comments panel remain in their own scope features. Their specs consume this contract.

## Decision

**Chosen option**: Option 1 in [rationale.md](rationale.md), Neon with Better Auth, Drizzle, and bounded polling.

Use a server only data access layer (the code that checks access and talks to the database), exposed through Next.js Route Handlers. Your existing Next.js, React, TypeScript, and visual theme remain the application foundation. (basis: `AGENTS.md`, installed Next.js data security guide, confirmed scope and stack choices.)

| Layer | Choice | Basis |
| :--- | :--- | :--- |
| Database | Neon Postgres, free tier first | Your explicit choice |
| Identity | Better Auth with its Drizzle adapter and database sessions | Your choice, installed Better Auth guidance |
| Queries and migrations | Drizzle ORM and Drizzle Kit, one migration history for auth and app tables | Confirmed choice, installed Neon Drizzle guidance |
| Runtime connection | Node.js 24, `pg`, `drizzle-orm/node-postgres`, pooled Neon URL, Vercel pool lifecycle support from `@vercel/functions` | Installed `neon-postgres` guidance for Vercel, interactive transaction requirement |
| Migration connection | Direct Neon URL, separate from the runtime pool | Installed `neon-postgres` guidance |
| Request interface | Same origin JSON Route Handlers using the Node runtime | Confirmed choice, installed Next.js Route Handlers guide |
| Device refresh | Native fetch with one shared polling controller per visible resource, three second interval | Confirmed freshness choice, request deduplication and small payloads |
| Description format | Restricted Tiptap JSON with explicit format version | Confirmed choice, installed Tiptap guidance |
| Hosting and cleanup | Vercel Hobby, daily authenticated Cron handler | Confirmed choice, verified Vercel Cron limits |
| Operations | Vercel function logs and Neon service dashboard | Small personal workload, no additional service selected |

**Implementation skills**:

* `neon-postgres` (`neondatabase/agent-skills`, `.agents/skills/neon-postgres/`)
* `neon-drizzle` (`neondatabase/ai-rules`, `.agents/skills/neon-drizzle/`)
* `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`)
* `better-auth-security-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-security-best-practices/`)
* `tiptap` (`ueberdosis/tiptap`, `.agents/skills/tiptap/`)
* `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.agents/skills/vercel-react-best-practices/`)

## Rationale

Reasoning, alternatives, research limits, and references: [rationale.md](rationale.md).

## Feature design

### Boundaries and prerequisite

This is a new foundation feature in a single repository. There is no existing task data to migrate. The build approach is **Tracer Bullet** and the workflow is **Alpha**. (basis: `docs/scope/scope.md`.)

The private account access design in `docs/specs/0002-private-account-access/index.md` was confirmed on 2026-11-03. It owns account provisioning, sign in methods, session lifetime, recovery, and sign out screens. Its implementation supplies the server session resolver, generated Better Auth user table with string IDs, and closed personal account enrollment policy. This spec requires database backed session validation on every data request and a `PERSONAL_ACCOUNT_ID` check. No client supplied identity or mock session may substitute for that contract. Schema preparation can begin independently; the first real signed in proof waits for the access feature's proved session resolver.

This feature owns storage, migrations, validators, data access functions, Route Handlers, and reusable client save and refresh logic. It does not build the final screens. Sharing, attachments, reminders, offline queues, collaborative editing, and application revision history are outside this contract. No regulated workflow was identified in the personal task scope.

### Data model sketch

All fields are required unless marked nullable or derived. Application identifiers are UUIDs generated on the server. Owner identifiers are text, matching Better Auth's user ID. Mutable records have a PostgreSQL `integer` revision starting at 1, encoded as a JSON number. All stored times are `timestamptz`; responses use UTC ISO strings. Date fields use PostgreSQL `date` and remain `YYYY-MM-DD` strings.

| Entity | Fields | Keys and relationships |
| :--- | :--- | :--- |
| Better Auth user | Generated auth schema, including `id: text` | Owns all application rows. No separate application profile table |
| `tasks` | `id: uuid`, `owner_id: text`, `title: text`, `description: jsonb` nullable, `description_version: smallint` default 1, `progress: smallint` default 0, `due_date: date` nullable, `revision: integer`, `created_at`, `updated_at`, `trashed_at` nullable | Primary key `id`; unique `(owner_id, id)`; owner references auth user |
| `tags` | `id: uuid`, `owner_id: text`, `name: text`, `normalized_name: text`, `revision: integer`, `created_at`, `updated_at` | Primary key `id`; unique `(owner_id, id)` and `(owner_id, normalized_name)`; owner references auth user |
| `task_tags` | `owner_id: text`, `task_id: uuid`, `tag_id: uuid`, `created_at` | Primary key `(task_id, tag_id)`; composite foreign keys `(owner_id, task_id)` and `(owner_id, tag_id)` reference the same owner's task and tag |
| `comments` | `id: uuid`, `owner_id: text`, `task_id: uuid`, `body: text`, `revision: integer`, `created_at`, `updated_at` | Primary key `id`; unique `(owner_id, id)`; composite foreign key `(owner_id, task_id)` references task |
| `creation_receipts` | `owner_id: text`, `request_id: uuid`, `operation: text`, `request_hash: text`, `resource_id: uuid`, `created_at` | Primary key `(owner_id, request_id)`; owner references auth user. Operation is `create_task`, `create_tag`, or `create_comment`. Resource ID has no foreign key, so the receipt survives resource deletion |

Status remains part of the logical Task model and API. It is derived from stored progress, avoiding a second stored value that could disagree. Empty descriptions and missing due dates use null. An empty description's format version remains 1. Receipts store no original content or serialized response and remain until account deletion. Ownership foreign keys cascade on account deletion; an account deletion interface is outside this feature.

**Indexes**:

* Tasks: `(owner_id, created_at DESC, id DESC)` for active rows; `(owner_id, trashed_at DESC, id DESC)` for trash rows; `(trashed_at, id)` for nonnull trash times used by cleanup.
* Tags: the unique name index also supports name ordered listing.
* Comments: `(owner_id, task_id, created_at, id)`.
* Assignments: primary key plus `(owner_id, tag_id, task_id)` for tag deletion and later filtering.

Task deletion cascades to comments and assignments. Tag deletion cascades to assignments. Deleting a tag also increments the revision and update time of every affected task in the same transaction. Renaming a tag changes its revision, without changing the task's assignment IDs.

### Validation and key invariants

Character limits count Unicode code points. Trim ECMAScript whitespace around titles, tag names, and comment bodies before checking for emptiness and length. Preserve internal spaces and comment line breaks. Reject NUL characters and lone UTF16 surrogates in text values. Database checks enforce text length limits, positive revisions, and progress bounds; structured document validation happens in the application.

| Value | Rule |
| :--- | :--- |
| Title | 1 to 200 characters, plain text |
| Comment | 1 to 10,000 characters, plain text |
| Tag display name | 1 to 50 characters, preserves the submitted capitalization after trimming |
| Assigned tags | At most 100 distinct tag IDs per task; an empty set removes all assignments |
| Tag uniqueness key | Apply Unicode NFKC normalization, full default Unicode case folding, then NFKC again, to the trimmed name. Use a pinned Unicode 15.1 mapping in the shared server normalizer, with common and full mappings, excluding Turkic and simple alternatives. Do not substitute ASCII lowercase or database locale defaults |
| Progress | Whole number from 0 to 100, enforced in the database |
| Status | `todo` at 0, `in_progress` at 1 to 99, `done` at 100 |
| Due date | Null or a real Gregorian calendar date, years 0001 through 9999. Reject impossible dates. No conversion through a timestamp |
| Description | Null or a valid format 1 document, at most 102,400 UTF8 bytes after JSON serialization, at most 5,000 nodes and 20 levels of nesting |
| Revision | Integer from 1 to 2,147,483,647; the server controls increments and never wraps or resets it |

Status and progress are alternative edit intents. A status change to `todo`, `in_progress`, or `done` sets progress to 0, 1, or 100 respectively. Selecting the current status is a no op and preserves its progress. A progress edit derives the matching status. Reject a patch supplying both intents, rather than depending on field order. Only changed data increments revision, after checking that the supplied revision is current.

Before an increment, atomically check that the current revision is below its maximum. If the matching current row is exhausted, return `503 REVISION_EXHAUSTED` without a partial mutation. Reads, no ops, and hard deletion do not need an increment and remain available. A tag deletion that would increment an exhausted task rolls back its whole transaction. Preserve the client draft and log the maintenance condition. Recovery requires a reviewed migration to widen the stored revision and define its API encoding, rather than resetting revisions or repeatedly retrying the failed write.

The normalizer is one shared function used on tag create and rename. Pin its Unicode mapping as a generated source asset, with provenance and cases covering `Work`, surrounding spaces, composed characters, width variants, and `Straße` versus `STRASSE`. The stored key exists to enforce database uniqueness; callers cannot submit it. Normalizer changes require a migration that detects collisions before rewriting keys.

### Description format 1

Export `descriptionSchemaV1` and `canonicalizeDescriptionV1` from `lib/tasks/rich-text.ts`. The same definitions govern client serialization, server validation, equality checks, and rendering. Use the Tiptap Document, Paragraph, Text, BulletList, OrderedList, ListItem, Bold, Italic, and Link extensions with the restrictions below. Do not enable StarterKit's additional nodes and marks.

Every object permits only the keys listed here. Optional arrays must be arrays if supplied; null is not an alternative. Reject unknown keys, node types, and attributes before canonicalization.

| Object | Permitted keys and structure | Canonical representation |
| :--- | :--- | :--- |
| `doc` | `type`, optional `content`; children are paragraphs or lists | Keep `type` and a nonempty `content` array, or convert an empty document to null under the rule below |
| `paragraph` | `type`, optional `content`; children are text nodes | Omit empty content |
| `text` | `type`, nonempty `text` string, optional `marks` | Preserve text exactly, including spaces; omit empty marks |
| `bulletList` | `type`, required nonempty `content` of list items | Keep content in order |
| `orderedList` | `type`, optional `attrs` containing only `start`, required nonempty list item `content` | Always include `attrs: { start }`, defaulting absent start to 1; start is an integer from 1 to 1,000,000 |
| `listItem` | `type`, required nonempty `content`; first child is a paragraph, later children are paragraphs or lists | Keep content in order |
| `bold` or `italic` mark | Only `type` | Keep the type |
| `link` mark | `type`, required `attrs` containing only required string `href` | Keep only type and href |

Marks are allowed only on text. Reject duplicate mark types on a text node. Sort valid marks in the order bold, italic, link, and merge adjacent text nodes with identical canonical marks. Missing and empty marks arrays are equivalent. Missing and empty paragraph content arrays are equivalent. Do not remove whitespace text or alter text normalization. Object key order has no semantic meaning; equality uses the shared recursively key sorted JSON representation after canonicalization, rather than raw editor or database object serialization.

Null, a root with absent or empty content, and a document composed solely of empty paragraphs become null. A list containing an empty paragraph remains a list document, preserving its intentional structure. An empty text string is invalid rather than an empty paragraph shortcut. A supplied empty attrs object is accepted only for an ordered list and resolves to start 1.

Trim href and require an absolute URL with `https`, `http`, or `mailto` scheme, with a 2,048 character limit. Store the validated trimmed string without other URL rewriting. Reject control characters and invalid Unicode in href. Render external links with fixed safe link attributes. Raw HTML, images, embedded content, styles, editor events, and other formatting are unsupported. Count the root as nesting level 1; enforce the node and depth limits on input and canonical output, and the stored byte limit on canonical JSON.

The editor adapter projects known editor defaults, such as link target, rel, and class, into the permitted format before calling the shared canonicalizer. Direct API input containing those unknown attributes is rejected. Then parse with `descriptionSchemaV1` and check document structure. Keep every Tiptap editor and extension package on one exact version line. The later task editor uses Tiptap's Composable API so its toolbar can share the editor context, and disables immediate rendering during server rendering. No paid editor extension is needed.

### State transitions

| Current state | Action | Result |
| :--- | :--- | :--- |
| Unsaved new task | Explicit Create with a valid title | Active task at progress 0, revision 1 |
| Active task | Valid field edit | Updated active task after successful autosave |
| Active task | Trash with current revision | Trash time set, revision increased, fields and children preserved |
| Trash before expiry | Restore with current revision | Trash time cleared, revision increased |
| Trash before expiry | Confirm permanent deletion with current revision | Task and children removed, receipts retained |
| Trash at or after expiry | Daily cleanup | Task and children removed, receipts retained |
| Any editable record | Stale revision | Saved state unchanged by that request, draft retained |
| Any editable record | Failed or lost response | Outcome can be uncertain, draft and original request retained for safe Retry |

The recovery deadline is `trashed_at + 720 hours`, using the database clock. Normal lists exclude all trashed tasks. Trash lists include only unexpired trash. Other owners always receive 404. Database row locks and conditional writes make restore and cleanup mutually exclusive.

Use one owner scoped parent lifecycle guard for every task route and every nested comment or assignment route, including permanent deletion and creation replay. After basic request validation and ownership lookup, expiry takes precedence over lifecycle conflicts, stale revision responses, and any response containing content. Mutations evaluate the database clock after taking the parent lock, so a lock wait cannot extend recovery. Reads evaluate expiry using the clock at the read decision. The guarded parent also supplies the response's database time.

An expired task or parent returns `410 RESOURCE_EXPIRED` on ordinary task and child routes, without `latest`, body text, title, description, or tags. Once removed, it returns `404 NOT_FOUND`. A matching creation replay whose resource or parent is expired or removed returns `410 CREATION_GONE`, also without content. Only the cleanup handler deletes expired tasks; the user permanent deletion route returns 410 after expiry. For unexpired trash, reads are allowed, normal edits are rejected, and only restore and confirmed permanent deletion can change its lifecycle. Independent tag operations may remove assignments from expired tasks but never return their content.

### API surface

Every application route below requires the personal session, except the cleanup route, which requires its own bearer secret. The `/api/auth/*` interface belongs to the account access spec. Route files live under `app/api/` and delegate to `server-only` modules under `lib/data/tasks/`. Database schema and connection modules live under `lib/db/`; shared task validation and document rules live under `lib/tasks/`.

JSON successes return `{ data, meta: { requestId, serverNow, replayed? } }`. Lists put `{ items, nextCursor }` in `data`. Errors return `{ error: { code, message, fields?, latest? }, meta: { requestId, serverNow? } }`. `fields` maps input paths to plain text validation messages. When allowed below, `latest` is `{ kind: "task" | "tag" | "comment", record }` containing the matching DTO. Do not expose database exceptions. `serverNow` comes from the database clock when available. A creation request sends an `Idempotency-Key` UUID header generated once by the client and retained with that draft.

| Endpoint | Method | Key inputs | Key outputs | Key errors |
| :--- | :--- | :--- | :--- | :--- |
| `/api/tasks` | GET | `state: active or trash` default active; optional cursor and limit | Page of TaskSummary | 422 bad page parameters, 503 unavailable |
| `/api/tasks` | POST | `title: string`, creation key header | TaskDetail, 201 new or 200 replay | 422 invalid title, 409 reused key, 410 deleted replay |
| `/api/tasks/[taskId]` | GET | Path UUID | TaskDetail | 404 unavailable to caller, 410 expired |
| `/api/tasks/[taskId]` | PATCH | `expectedRevision: integer`; nonempty patch of title, description with descriptionVersion, dueDate, status or progress | TaskDetail | 409 stale or in trash, 422 invalid fields, 410 expired |
| `/api/tasks/[taskId]` | DELETE | `expectedRevision: integer` | Trashed TaskDetail | 409 stale, 404 missing, 410 expired |
| `/api/tasks/[taskId]/restore` | POST | `expectedRevision: integer` | Restored TaskDetail | 409 stale, 410 expired |
| `/api/tasks/[taskId]/permanent` | DELETE | `expectedRevision: integer`, `confirmed: true` | `{ id, deleted: true }` | 409 stale or not in trash, 422 missing confirmation, 410 expired |
| `/api/tags` | GET | Optional cursor and limit | Page of Tag | 422 bad page parameters |
| `/api/tags` | POST | `name: string`, creation key header | Tag, 201 new or 200 replay | 409 duplicate normalized name or reused key, 422 invalid name, 410 deleted replay |
| `/api/tags/[tagId]` | PATCH | `expectedRevision: integer`, `name: string` | Tag | 409 stale or duplicate name, 404 missing |
| `/api/tags/[tagId]` | DELETE | `expectedRevision: integer` | `{ id, deleted: true }` | 409 stale, 404 missing |
| `/api/tasks/[taskId]/tags` | PUT | `expectedRevision: integer`, `tagIds: uuid[]` representing the full desired set | TaskDetail with new revision | 409 stale or in trash, 422 invalid or foreign tag reference, 410 expired |
| `/api/tasks/[taskId]/comments` | GET | Optional cursor and limit | Page of Comment | 404 missing task, 410 expired |
| `/api/tasks/[taskId]/comments` | POST | `body: string`, creation key header | Comment, 201 new or 200 replay | 409 task in trash or reused key, 422 empty body, 410 expired or deleted replay |
| `/api/tasks/[taskId]/comments/[commentId]` | PATCH | `expectedRevision: integer`, `body: string` | Comment | 409 stale or task in trash, 404 missing, 410 expired |
| `/api/tasks/[taskId]/comments/[commentId]` | DELETE | `expectedRevision: integer` | `{ id, deleted: true }` | 409 stale or task in trash, 404 missing, 410 expired |
| `/api/internal/tasks/cleanup` | GET | `Authorization: Bearer <CRON_SECRET>` | `{ purged: number, remainingEligible: boolean }` | 401 wrong secret, 503 database failure |

**Response values**:

* TaskSummary: ID, title, derived status, progress, dueDate, revision, createdAt, updatedAt, trashedAt, derived expiresAt, and assigned tags containing ID, name, and revision.
* TaskDetail: TaskSummary plus description and descriptionVersion. Comments have their own paginated route.
* Tag: ID, name, revision, createdAt, updatedAt. Comment: ID, taskId, body, revision, createdAt, updatedAt.
* No DTO (the object returned to the browser) includes owner IDs, auth records, credentials, request fingerprints, or receipts.

The API table is the completed foundation contract. In the initial task only release, TaskSummary and TaskDetail return `tags: []` directly and never query tables that have not been introduced. The tag and comment release first applies its compatible migration, then deploys the code that joins assignments and exposes those routes. That release always queries the real tables; a missing table is an unavailable response, never an empty list fallback. Older task only code can run against the expanded schema without deleting assignments it does not read.

All list routes default to 50 items and accept 1 to 100. Cursor pagination uses a versioned, validated base64url JSON boundary bound to the requested dataset, never an owner supplied by the caller. Active tasks order by creation time descending then ID descending. Trash orders by trash time descending then ID descending. Tags order by normalized name then ID ascending. Comments order by creation time then ID ascending. An empty page returns an empty array and null cursor. Future search and sorting features may extend this surface through their own spec.

Display one page per collection, replacing that page atomically when polling succeeds. Do not append or merge cached page contents. The current cursor boundary and navigation boundaries are not a frozen database snapshot: concurrent creation, deletion, trash, or tag rename can move rows across pages during traversal. Next uses the latest response's nextCursor. If the current page becomes empty, return to the first page. Explicit Refresh from start clears navigation boundaries and fetches the first page; local membership or ordering changes reset the affected collection in the same way. Focus and reconnection refresh the current page. Keep selection and unsaved drafts outside the page cache. This is an eventually consistent live view, with no guarantee of seeing every row exactly once during a changing traversal.

Unknown request fields and invalid cursors return 422. Invalid JSON returns 400, unsupported content types return 415, and requests over 256 KB return 413. Validate actual received bytes, not just Content-Length. All application responses use `Cache-Control: private, no-store`, and reads use uncached fetches. There is no shared application data cache or public cross origin API.

### Shared error contract

The following mapping applies to every implemented data route, in addition to its endpoint specific cases. After route configuration, authentication, Origin, and bounded basic input validation, resolve ownership and the parent lifecycle guard before revision or content bearing errors. A foreign or missing child under an accessible parent remains 404. Do not include `latest` unless this table explicitly permits it, and never include expired content.

| HTTP status and code | Response detail | Client action |
| :--- | :--- | :--- |
| 400 `INVALID_JSON` | No latest | Preserve draft, correct request encoding before resubmission |
| 401 `UNAUTHENTICATED` | No latest | Pause reads and writes, offer reauthentication, retain draft |
| 401 `INVALID_CRON_AUTH` | No latest | Cleanup does no work; correct invocation authorization |
| 403 `PERSONAL_ACCOUNT_REQUIRED` | No latest | Stop data access for this session |
| 403 `ORIGIN_FORBIDDEN` | No latest | Preserve draft, stop the rejected write; correct the origin configuration or client |
| 404 `NOT_FOUND` | No latest | Remove the unavailable saved view, keep any draft available to copy; a repeated hard delete is already complete |
| 405 `METHOD_NOT_ALLOWED` | No latest, Allow header | Preserve draft; use a supported method |
| 409 `REVISION_CONFLICT` | Latest accessible task, tag, or comment | Pause writes and open deliberate comparison and reapplication |
| 409 `TASK_IN_TRASH` | Latest unexpired parent task | Pause normal edits, offer copying and the normal restore path |
| 409 `TASK_NOT_IN_TRASH` | Latest active task | Require a new explicit trash action before permanent deletion |
| 409 `DUPLICATE_TAG_NAME` | `fields.name`, latest existing tag from this account | Rename the proposed tag or deliberately use the existing one |
| 409 `IDEMPOTENCY_KEY_REUSED` | No latest | Keep the original uncertain request intact; only a new intentional creation may get a new key |
| 410 `RESOURCE_EXPIRED` | No latest or resource content | Remove the expired saved view, stop edits and restore, retain an existing draft only for copying |
| 410 `CREATION_GONE` | No latest or resource content | Treat the original creation as gone; do not recreate it through Retry |
| 413 `PAYLOAD_TOO_LARGE` | No latest | Reduce input size, preserve draft |
| 415 `UNSUPPORTED_MEDIA_TYPE` | No latest | Submit JSON through the supported client |
| 422 `VALIDATION_FAILED` | Field messages, no latest | Keep draft and correct fields. Includes bad IDs, cursors, creation keys, confirmation, or linked tag references |
| 422 `UNSUPPORTED_DESCRIPTION_VERSION` | `fields.descriptionVersion`, no latest | Stop editing that description; supported fields can still be edited separately |
| 503 `CONFIGURATION_REQUIRED` | No latest or secret values | Preserve draft; resume after the affected server capability is configured |
| 503 `STORAGE_UNAVAILABLE` | No latest | Read backoff continues; an uncertain write waits for explicit Retry |
| 503 `REVISION_EXHAUSTED` | No latest | Preserve draft and stop automatic write attempts pending a reviewed maintenance migration |
| 504 `REQUEST_TIMEOUT` | No latest | Preserve the exact uncertain write and its key or revision; explicit Retry uses it |
| 500 `INTERNAL_ERROR` | No latest | Preserve draft and request ID; do not automatically replay a mutation |

A normal read of an unknown stored description version still returns the task with an unsupported format state in the client; it is not a failed read. A description patch naming an unsupported format returns its 422 code. Use explicit JSON 405 responses for methods handled by these route modules. Unknown routes and platform generated failures can have another body shape; the controller treats an unrecognized error, a network failure, or a malformed success response as a failed read or uncertain write, retaining the original request. Message text is for people; clients branch on the stable code and HTTP status.

### Writes, retries, and client behavior

Perform mutations in explicit transactions. Resolve the session and personal account before access. Scope each query by owner, including child lookups. Match mutable rows by owner, ID, revision, and allowed lifecycle state in the database. A zero row update triggers an owner scoped lookup to distinguish missing, expired, trashed, or stale data. Revision checks and writes must be atomic.

For creation, normalize the request and compute a SHA256 fingerprint, stored as lowercase hexadecimal, over canonical JSON containing operation, parent task ID where relevant, and normalized payload. Canonical JSON sorts object keys recursively and preserves array order. In one transaction, reserve the owner and request key, create the resource, and store its ID and fingerprint. A concurrent duplicate waits for that transaction. A matching receipt returns the current accessible resource with `replayed: true`. A mismatched fingerprint returns `409 IDEMPOTENCY_KEY_REUSED`. If the resource is gone or its parent is expired, return `410 CREATION_GONE`. Never create a replacement from that key. A new intentional create uses a new key.

A task or comment already in trash can be returned by a matching creation replay as saved, read only data. A receipt must not bypass current ownership or expiry checks. Receipt insertion rolls back if resource creation fails. Receipt records are not returned through an application endpoint.

Lock the parent task before child mutations and check that it is active. Assignment changes also increment the task revision. Comment edits use their own revisions and do not increment task revision. Serialize assignment changes and tag deletion with a transaction advisory lock derived from the owner ID, acquired before task locks. Under that lock, tag deletion finds affected tasks, locks them in ID order, then removes the tag and bumps those tasks. This prevents new assignments entering between the affected task scan and deletion. Cleanup locks eligible tasks before deletion and rechecks expiry. These operations cannot leave partial children or mixed ownership links.

A repeated trash request for a task already in trash and a repeated restore for an already active task can return the current state without another change. If the task changed lifecycle again, the old revision cannot trigger a second transition. A repeated hard deletion can return 404; the client treats a confirmed missing target as removed. PATCH retries after an uncertain outcome may return a conflict with the latest saved values. They never overwrite a newer revision automatically.

The client controller keeps a saved base, the current draft, the latest remote version, and the exact in flight request. It allows one write per record at a time. Task fields, assignment changes, and lifecycle operations share the task's queue. Before a destructive action, pending edits must save successfully or be deliberately discarded, and queued autosaves are canceled. Keystrokes during a write stay in the draft; a response only acknowledges the submitted snapshot, and a later write uses the returned revision. Clearing a save indicator must not clear newer edits.

Task field edits autosave after 750 milliseconds of inactivity. An invalid task draft remains local until valid. Creation, comment Add and Save, tag creation and rename, assignment changes, and destructive actions are explicit. All writes stop for a record after a failed or uncertain response until Retry or deliberate conflict resolution. Retry reuses the original creation key or revision for the uncertain request before attempting any newer draft changes.

On conflict, retain the original base, local draft, and latest accessible remote record. Show the versions for review. The user can discard the draft or deliberately reapply it against the latest revision. Reapplication establishes a new base only through that explicit action. A remotely trashed or deleted task cannot be automatically restored by a draft save; offer copying the draft and the normal restore path when available.

Poll only the list page, open task detail, and comment or tag surfaces currently displayed. Share reads for identical resource keys and schedule the next poll without overlap. Clean data can refresh automatically. A higher remote revision on a dirty record pauses autosave and enters conflict review. A matching poll value alone does not acknowledge an uncertain write.

Give each resource key a read generation and monotonically increasing read sequence. A response may apply only if its generation is current and its sequence has not been superseded. When a mutation settles, including an uncertain failure, advance the generation for its record and every displayed collection or projection it can affect, cancel earlier reads, and ignore their callbacks. A tag rename or deletion invalidates visible task projections as well as tag views. Defer poll reconciliation while a relevant write is in flight; after settling the write, reconcile its response and begin a fresh read in the new generation. A poll started before a successful save cannot replace that saved base or trigger a conflict afterward. Also reject a returned record revision lower than the highest revision already accepted for that entity type and ID, sharing that floor across list and detail resource keys.

Treat tag labels as independently versioned presentation data. Maintain current tag ID, name, and tag revision separately from a task's editable draft and assigned ID set. A newer tag revision can refresh its displayed label while the task revision stays equal; it does not rebase task fields, replace a dirty draft, or create a task conflict. Ignore older tag label revisions. If a tag editor itself has a dirty rename, its own tag revision rules still produce a conflict. Assignment removal is different: it changes task revision and follows normal task conflict rules.

After a local operation changes membership or ordering, reset that collection to its first page. Other successful mutations refresh the current page. Apply the pagination behavior above without merging old page contents, and retain task selection and drafts independently.

Read failures retain the last snapshot and show a connection state. Retry reads with delays of 3, 6, 12, then at most 30 seconds. Focus or reconnection resets the delay. Successful polling aims to show a committed remote change within three seconds plus request latency; this is not a hard availability guarantee. Reconnection resumes reads, while failed writes still require explicit Retry.

A 401 pauses polling and writes and offers reauthentication while preserving the open draft, preferably through a separate sign in tab. A 403 stops access. Explicit sign out clears in memory task data after the user has had a chance to copy unsaved content. Drafts never enter localStorage, IndexedDB, a service worker queue, logs, or analytics. Browser leaving warnings are best effort; closing or reloading the tab can lose the draft. Copy draft provides readable plain text, with a selectable text fallback if clipboard access is unavailable.

### Value sourcing

| Action | Value produced or displayed | Source |
| :--- | :--- | :--- |
| Authorize any request | Owner and eligibility | Validated Better Auth database session user ID, compared with server `PERSONAL_ACCOUNT_ID` |
| Create any application record | ID, initial revision, timestamps | Server UUID generation, revision 1, database clock |
| Create task | Title and initial state | Normalized title input, progress 0, null description, null due date, null trash time |
| Edit task | Changed fields and status | Validated patch; status intent maps to progress, status output derives from stored progress |
| Save or reject stale edit | New revision or latest record | Atomic owner and expected revision condition, then owner scoped lookup |
| Display a description | Document and supported format | `description`, `description_version`, shared format 1 schema |
| Display due and overdue | Due date and local calendar day | Stored date; current device clock and browser timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. A task is overdue when dueDate precedes today locally and progress is below 100 |
| Display timestamps | Created, updated, trash and expiry times | Stored UTC instants; expiry is trash time plus 720 hours; later screens format in the device timezone |
| Display tags | Assigned IDs and names | Same owner assignment join to current tag records |
| Display tags in the initial release | Empty assigned tag list | Explicit task only release constant; later release replaces it with the assignment join after migration |
| Refresh a renamed tag label | Label and presentation revision | Current tag record keyed by ID and tag revision, independent of the task's editable base |
| Normalize or reject tag | Name, uniqueness key, duplicate conflict | Trimmed input, pinned Unicode normalizer, database unique constraint |
| Add or edit comment | Body, parent, order and edited time | Normalized body input, task ID path, creation and update columns, ID tie breaker |
| Retry creation | Saved resource or deleted result | Client retained request key, server normalized fingerprint, owner scoped receipt and current resource lookup |
| Show trash eligibility | Recoverable state and expiry | Stored trash time, database `serverNow`, 720 hour rule; client time cannot authorize restore |
| Refresh displayed data | Current page and selected record | Active view's IDs and cursors, owner scoped GET responses, three second visible timer |
| Accept a read after a write | Eligible response and revision floor | Client resource generation, read sequence, and highest accepted record revision; mutation settlement invalidates prior generations |
| Handle unsaved work | Draft, save state, copied text | In memory saved base, draft, submitted snapshot, and last response |
| Cleanup | Eligible IDs, purge count and backlog | Database clock and trash index; count of rows deleted in committed batches, remaining eligible existence query |
| Paginate | Next cursor and stable order | Returned final row's specified ordering values and dataset key |
| Explain an error | Code, field errors, correlation ID | Defined failure mapping, validator results, server generated request ID |

### Security and configuration

Use the session resolver exported by `lib/auth/server.ts`, with the generated schema in `lib/db/schema/auth.ts`. These paths are the integration contract for the separate account access feature. Check a live database session rather than trusting a client user object or a cached cookie identity. Missing session returns 401; an authenticated user other than `PERSONAL_ACCOUNT_ID` receives 403. Missing configuration required by the invoked capability returns `503 CONFIGURATION_REQUIRED` before its data access.

Every normal operation is scoped in the DAL (data access layer), rather than relying on a page redirect. Foreign or nonexistent resource IDs return the same 404. Composite foreign keys enforce owner consistency for linked records. Browser code never connects directly to Neon. Database row security policies are not required for this server credential model; introducing browser database access would require a new decision.

Validate write Origin against the exact configured application origin, reject missing or foreign origins, require JSON, and keep cookie protections and Better Auth CSRF checks enabled. The cleanup route uses its bearer secret instead of browser session and Origin rules. Avoid wildcard trusted origins. Auth endpoint throttling and account security logs belong to the private account access feature; do not rely on per process memory for an auth rate limit on Vercel.

| Configuration | Purpose and source |
| :--- | :--- |
| `DATABASE_URL` | Pooled runtime connection string supplied by your Neon project |
| `DATABASE_URL_UNPOOLED` | Direct connection string for migration tooling, kept out of runtime deployment variables where practical |
| `BETTER_AUTH_SECRET` | Auth encryption secret supplied through the secret flow during auth setup |
| `BETTER_AUTH_URL` | Exact application base URL; local development uses its explicit local origin |
| `PERSONAL_ACCOUNT_ID` | Provisioned Better Auth user ID selected by the private account setup, never an email or a browser parameter |
| `CRON_SECRET` | Independent cleanup bearer secret supplied through the secret flow during deployment setup |

Validate configuration within each capability, rather than through a module that requires every variable on every request:

| Capability | Required configuration | Isolation rule |
| :--- | :--- | :--- |
| User task, tag, and comment routes | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PERSONAL_ACCOUNT_ID` | Do not require the Cron secret or migration URL |
| Better Auth runtime | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, plus capability settings in spec 0002 | User provisioning can precede selection of PERSONAL_ACCOUNT_ID; task data stays closed until that ID is set. Schema generation belongs to spec 0002's separate generation configuration |
| Cleanup handler | `DATABASE_URL`, `CRON_SECRET` | Import neither the session resolver nor auth or personal account configuration |
| Drizzle migration tool | `DATABASE_URL_UNPOOLED` | Import schema definitions without initializing the runtime pool or auth server; no runtime URL, personal ID, or Cron secret required |

Validate connection strings, nonempty account ID, a valid application URL, and nonempty secrets in their own capability. The auth secret follows Better Auth's strength requirements. Log the missing configuration names without values and return the generic capability error to callers. A misconfigured cleanup handler must not stop ordinary task reads, and a migration only URL must not be a runtime prerequisite.

No new secret is requested or generated by this architecture task. Local secrets belong in ignored environment files, and production secrets belong in deployment settings. Preview deployments use a separate development database or branch, never production data credentials. Keep pool and secret modules server only. Use a small runtime pool, initially three connections per instance, a five second connection timeout, and Vercel's pool lifecycle support. Bound transactions with local statement and lock timeouts, five and two seconds respectively; bound ordinary query waits to five seconds and request handling to 15 seconds. A timeout is an uncertain write outcome and follows Retry rules.

### Cleanup and format changes

Configure a production Vercel Cron entry for `/api/internal/tasks/cleanup` at `0 2 * * *` UTC. Verify its `Authorization` bearer value against `CRON_SECRET`. Use a constant time comparison after checking lengths, and disable caching. Missing or invalid authorization performs no work.

Each invocation deletes up to five batches of 100 eligible tasks, stopping before its request deadline. Use separate short transactions and skip rows already locked by another invocation. Foreign key cascades remove comments and assignments; receipts and reusable tags remain. Return committed purge count as `purged: number` and the remaining eligible existence query as `remainingEligible: boolean`. A failure returns 503 and logs the completed count and request ID. The next daily run, or an intentional authorized rerun, resumes safely. Vercel does not guarantee invocation at the exact minute on Hobby, so recovery expires at 30 days while physical deletion follows the next successful sweep. Do not use `pg_cron` as the sole scheduler for a compute that can suspend.

Keep reviewed Drizzle migration files in version control. Spec 0002 owns the first migration, which creates the generated auth schema and shared attempt counters. This feature reuses those definitions and adds tasks and creation receipts in a subsequent migration in the same history, then tags, assignments, and comments in its next application migration. Do not generate or recreate auth tables in this feature. The Better Auth generator does not separately migrate this database. Never apply schema changes on an ordinary request, use production schema push, or erase migration history to resolve drift.

Test migrations on a development branch before production. Apply compatible additions before deploying code that depends on them. A failed migration or missing column returns a controlled unavailable response, retaining drafts. A failed deploy rolls back application code while leaving compatible database additions in place. Destructive changes need a separate reviewed migration and a verified recovery path; restoring a database after later writes requires an explicit recovery decision.

Version document transformations separately from table migrations. An unknown description version stays unchanged, displays an unsupported format state, and cannot be edited by that client. Other supported task fields remain editable without resubmitting the description. Format upgrades preserve the original until conversion validates successfully. Plain text comments never render as HTML.

Log operation name, request ID, elapsed time, result code, conflict count, and cleanup counts through the hosting logs. Do not log request bodies, document JSON, names, comment text, cookies, hashes, or connection strings. There is no separate metrics or alerting service in this release. Check failed cleanup runs and backlogs through the deployment logs.

### Critical test scenarios

| Scenario | Criteria |
| :--- | :--- |
| Create a task through a real session, reload, and read the same ID on another device | AC-1, AC-2, AC-10 |
| Reject signed out, other account, foreign parent, and forged owner requests | AC-1, AC-2 |
| Exercise every status boundary, reselect current status, reject fractions and impossible dates, compare due dates across timezones | AC-3 |
| Round trip all allowed formatting; reject unsafe links, unknown attributes, malformed trees, excessive depth and size; preserve unknown future formats | AC-4, AC-13 |
| Canonicalize absent and empty arrays, mark order, adjacent text, empty paragraphs and empty list items; reject duplicate marks and empty text nodes | AC-4 |
| Race case equivalent tag creation and rename; delete a tag assigned to active and trashed tasks | AC-5, AC-9 |
| Add, edit, and delete comments; check stable timestamp order and parent trash restrictions | AC-6, AC-11 |
| Type during an in flight autosave, fail its response, edit again, and Retry without clearing newer text | AC-7, AC-9, AC-14 |
| Observe a committed change on a visible second device; hide it and return; refresh while its draft is dirty | AC-8, AC-9 |
| Complete a save before an earlier poll returns; ensure the old poll cannot replace the base or cause a false conflict with new keystrokes | AC-7, AC-8, AC-9 |
| Rename a tag remotely while a task draft is dirty; refresh only its presentation label, and separately exercise a dirty tag rename conflict | AC-5, AC-8, AC-9 |
| Race two writes with the same expected revision, and race comment creation against trash | AC-9, AC-11 |
| Lose a creation response and retry; race matching keys; reuse a key with changed content; retry after resource purge | AC-10 |
| Restore just before expiry, reject at expiry, race restore with cleanup, and repeat permanent deletion | AC-11, AC-12 |
| Cross expiry while waiting on a parent lock; exercise every task and nested route, including stale comment writes and creation replay, with no expired latest content | AC-1, AC-9, AC-10, AC-12 |
| Reject an unauthenticated cleanup call; interrupt a batch; rerun with a backlog and confirm only expired rows disappear | AC-12, AC-14 |
| Apply the auth prerequisite once, then both incremental application schema phases on a fresh development branch; reject duplicate auth DDL, simulate migration failure, and deploy compatible older code | AC-2, AC-13 |
| Run task create and read before tag tables exist, then migrate and deploy tag joins without a missing table fallback | AC-2, AC-13 |
| Omit Cron and migration variables from the runtime task environment; verify ordinary access still works and only the affected capability fails | AC-1, AC-13 |
| Exercise each shared error code, latest payload rule, and recovery action, including an unrecognized platform failure | AC-9, AC-10, AC-13, AC-14 |
| Move tag names across a cursor boundary, delete a current page, and refresh from start while retaining a selected dirty task | AC-5, AC-8, AC-14 |
| Set a current revision to its maximum; reject increments without partial changes, retain reads and draft, and roll back a tag deletion affecting that task | AC-2, AC-9, AC-13 |
| Exercise empty pages, cursor validation, session expiry, unreachable storage, clipboard fallback, leaving warning, and content free logs | AC-1, AC-14 |

The Alpha workflow uses real application verification with `/check verify`. No separate automated suite or independent model code review is required by that workflow. The implementation can add focused checks where needed to prove transaction and parser behavior.

## Build plan

The recommendation is to build these slices in order. Each extends a real data path. The signed in first slice waits for the private account access spec and session implementation; later UI features reuse these interfaces.

1. **Establish the real private task thread.** Complete the auth prerequisite from spec 0002, including its first reviewed migration and proved session resolver. Reuse the pinned compatible packages, Node runtime pool, direct migration connection, and generated auth schema. Add tasks and creation receipts in a subsequent reviewed migration in the same history, without auth DDL. Add owner checked create and read routes with title validation and creation replay. Return tags as an explicit empty array without querying future tables. Prove one task survives reload and a second signed in device. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-10**, **AC-13**.
2. **Complete task editing through the same path.** Add shared field and canonical Tiptap validators, version conditioned PATCH, the shared error contract, task DTOs, the in memory save controller, generation ordered polling, conflict review data, failure recovery, leaving guard, and copy support. Prove date, format, and concurrent write cases through a minimal private integration surface, without building the final task table. Satisfies **AC-3**, **AC-4**, **AC-7**, **AC-8**, **AC-9**, **AC-14**.
3. **Extend storage and routes to tags and comments.** Apply this feature's second application migration, following the auth prerequisite and task migration, for tags, assignments, and comments before deploying code that joins them. Add normalization, ownership constraints, single page live pagination, explicit mutations, receipt replay, independent tag label revisions, and parent lifecycle locking. Extend the same refresh controller where those resources are displayed. Satisfies **AC-2**, **AC-5**, **AC-6**, **AC-8**, **AC-9**, **AC-10**, **AC-14**.
4. **Add the recovery and expiry path.** Implement trash, read only recovery data, restore, confirmed permanent deletion, the shared expiry guard across every task and child route, and the authenticated bounded Cron sweep. Verify races and interrupted cleanup with real database data. Satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**.
5. **Close compatibility and operational checks.** Verify all bounded reads, stable error mappings, revision exhaustion, request limits, capability scoped configuration, secret boundaries, migration failure handling, unsupported formats, and content free logging. Run lint and production build, then `/check verify` against every criterion using the real session and development database. Remove a temporary integration surface if it was used; keep reusable data logic for the later screens. Satisfies **AC-1**, **AC-2**, **AC-4**, **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**.

## Consequences

**Positive**:

* Ownership, conflicts, and retry safety are defined before task screens depend on storage.
* One database and migration history supports the personal task model.
* Later features can reuse the same task identity, validated document format, and request contracts.

**Tradeoffs**:

* Polling consumes function requests and database activity while a surface is open. Free tier suitability depends on actual use; no unlimited free operation is promised.
* There is a delay of up to the polling interval plus request latency between devices.
* Drafts disappear when their tab closes, and browser leaving warnings cannot cover every mobile or process termination case.
* Daily cleanup physically removes expired rows on a successful sweep. Outages or a backlog can delay that removal.
* Receipt metadata grows until account deletion. Deleted task and comment content is not retained in these records.
* Full Unicode tag folding needs a pinned mapping and collision aware migrations.

**Neutral**:

* The task interfaces are private and need no public search indexing or SEO work.
* Package versions are selected and pinned through the first integration check, including Better Auth generation, Drizzle transactions, Tiptap parsing, React 19.3 rendering, and the production build. This spec does not invent an unverified version matrix.

## Follow-up

* [x] Design and approve private account access before implementing its auth configuration or claiming the first real private task loop works. Design confirmed in spec 0002 on 2026-11-03; implementation remains pending.
* [ ] Record `neon-postgres` connection and migration conventions in root `AGENTS.md`, with its skill pointer.
* [ ] Record `neon-drizzle` schema conventions in root `AGENTS.md`, with its skill pointer.
* [ ] Record `vercel-react-best-practices` data fetching and rendering guidance in root `AGENTS.md`, with its skill pointer.
* [ ] Record `better-auth-best-practices` in `lib/auth/AGENTS.md`, with a short root pointer once that area exists.
* [ ] Record `better-auth-security-best-practices` in the same auth area context.
* [ ] Record `tiptap` document schema guidance in `lib/tasks/AGENTS.md`, with a short root pointer once that area exists.
* [ ] Keep MCP connections deferred, as chosen. Candidate sources and access notes are preserved in the rationale.
* [ ] Later task, tag, comment, and list feature specs can reuse this contract and define their final screens and controls.
