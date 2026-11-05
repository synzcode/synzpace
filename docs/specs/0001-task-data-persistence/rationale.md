# Task data and persistence rationale

## Context

> Prerequisite note: the private account access design in `docs/specs/0002-private-account-access/index.md` was confirmed on 2026-11-03. Its unbuilt first slice owns the auth migration and proves the real session contract. Task tables follow in the same migration history before the first signed in task proof.

You are building a private dashboard for your own daily work, with a task table and detail panel planned as its first useful feature. Your work must survive reloads and remain available across devices. Without a shared persistence contract, later screens would have to invent ownership, date handling, conflicts, and deletion separately. (basis: `docs/scope/scope.md`.)

The repository has seven source files and an existing Next.js 16.4.4, React 19.3, TypeScript, and Tailwind foundation. There is a visual theme and a preview page, but no task model, database integration, or authentication implementation. Root `AGENTS.md` requires the installed Next.js guides before code changes. There are no earlier specs and no configured Git remote, so team freshness could not be checked. This is a new FEATURE spec in a single repository. (basis: `AGENTS.md`, `package.json`, source inventory, local Git state.)

You selected Neon and Better Auth directly. You prefer a free tier starting point. You accepted three second polling, Vercel Hobby with daily cleanup, Drizzle, and Tiptap. This spec follows the project's Tracer Bullet build approach and Alpha verification workflow. No sign in method, public enrollment flow, sharing model, or offline editing requirement was added. (basis: confirmed design conversation and `docs/scope/scope.md`.)

## Options considered

### Option 1: Neon, Better Auth, Drizzle, and bounded polling

Use your chosen database and auth library, one shared schema history, Route Handlers, and a short polling loop. This is the chosen approach. (basis: your confirmed stack choices, installed Next.js data security guide, installed Neon and Better Auth skills.)

**Pros**: meets the accepted freshness target with one data service; transactions can enforce ownership, revisions, and receipts together; no event delivery service is required.

**Cons**: visible devices generate recurring reads; changes take a polling interval to appear; you operate the application auth configuration and cleanup job.

### Option 2: The same database stack with pushed invalidations

After a committed write, publish a small account scoped notification through a service such as Ably, then have clients fetch authoritative private data. This is the runner up if the accepted delay becomes a problem. (basis: verified [Ably Free documentation](https://ably.com/docs/platform/pricing/free), commit and notification failure handling.)

**Pros**: faster notification and fewer routine unchanged reads; supports more continuously open devices.

**Cons**: adds another service and authorization system; a successful database commit followed by failed publication needs reconciliation; reconnect still needs a full refresh. Token authorization and the exact Next.js integration were not verified in this research pass.

### Option 3: Neon and Better Auth with Prisma

Use Prisma's schema, migrations, and generated client with Better Auth's adapter. (basis: verified [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma).)

**Pros**: supported integration and a generated query client; appropriate if you already preferred Prisma's workflow.

**Cons**: introduces a different generation workflow without a need in this repository; you selected Drizzle after comparing the alternatives.

### Option 4: Direct SQL with manual refresh

Keep a smaller application layer with manually written SQL and refresh only on navigation or explicit action. This is the simplest operating shape, though it misses the chosen freshness behavior. (basis: relational transactions, installed Next.js data access guidance, your live update requirement.)

**Pros**: fewest libraries and no recurring poll loop.

**Cons**: more handwritten mapping and migration discipline; manual refresh does not meet your requirement for changes to appear while devices are open.

## Rationale

The main problem is reliable personal data across devices. Your accepted three second interval makes polling a sufficient first solution. The same database can commit a task, its ownership, its revision, and its creation receipt atomically. That removes the need for a separate event transport or offline reconciliation system in this release. (basis: confirmed design conversation, optimistic concurrency control, idempotency keys and atomic transactions.)

Your provider choices stay in force. Better Auth supplies the identity; Neon supplies Postgres; Drizzle provides a shared schema and migration path. Better Auth's adapter generates its schema, and the default identity ID remains a string. (basis: verified [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) and [database and IDs](https://better-auth.com/docs/concepts/database).)

The installed Neon Postgres skill specifically recommends `pg` with Vercel pool lifecycle support for this host. That guidance refines the earlier generic research suggestion of Neon's WebSocket Pool. The spec therefore selects the standard Postgres driver for the Node runtime, retains transaction support, and uses the direct URL for migrations. (basis: `.agents/skills/neon-postgres/SKILL.md`, [Drizzle Neon connection guidance](https://orm.drizzle.team/docs/connect-neon).)

The older generic adapter matrix in the installed Neon Drizzle references assumes Vercel means Edge and describes HTTP as having no transactions. The verified current Drizzle guidance distinguishes interactive from noninteractive transactions. The host specific Node choice above governs this spec. The first implementation gate must pin and exercise the actual Better Auth, Drizzle, driver, and pool lifecycle integration. (basis: installed skill comparison, verified Drizzle connection guide.)

Tiptap supplies the agreed JSON document format. Its restricted schema is shared with server validation, and a format number makes future changes explicit. Lexical was a possible runner up, but its serialization page failed verification and exact React compatibility was not established. The comparison does not claim otherwise. Tiptap's Composable API fits the planned toolbar and editor sharing, and its installed setup guidance requires disabling immediate rendering during server rendering. (basis: installed Tiptap skill and setup reference, verified [content handling](https://tiptap.dev/docs/guides/output-json-html) and [React integration](https://tiptap.dev/docs/editor/getting-started/install/react).)

The confirmed logical Task model includes status, but status is completely determined by progress. Deriving it in responses keeps the same editing behavior while removing an inconsistent stored pair. The tag uniqueness key is stored specifically for a database uniqueness constraint. A pinned full Unicode folding rule makes names behave consistently across machines and database locales. (basis: confirmed data model, derived value consistency, Unicode normalization and default case folding.)

Trash is a deliberate product requirement. A separate trash timestamp preserves task status and progress, while every read and write applies an explicit lifecycle scope. The 30 day recovery deadline uses the database clock. Vercel's daily sweep removes expired live database rows later; this does not promise deletion at the exact expiry instant or define provider backup retention. (basis: confirmed trash choices, verified [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).)

Neon supports `pg_cron`, but the verified guidance says it runs only while compute is active. Scheduled Neon Function Triggers were mentioned as an alternative; their free tier eligibility was not verified. Vercel Cron is the selected external wakeup mechanism for the chosen host. (basis: verified [Neon pg_cron guidance](https://neon.com/docs/extensions/pg_cron), [Vercel Cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs).)

Creation receipts have no resource foreign key and no original content. Keeping them after resource deletion prevents an old delayed request from recreating a deleted task, tag, or comment. Revision checks protect later edits. These are separate responsibilities: a repeated creation must identify its original result, while a stale edit must preserve the newer result. (basis: confirmed receipt model, idempotency keys, optimistic concurrency control.)

## Cross check and resolutions

GPT 6.1 Terra at high reasoning reviewed the first draft on 2026-11-03. It read the local spec and scope without changing files or fetching references. It identified six missing decisions, three soundness issues, and one naming clarification. You approved the recommended fixes. The main thread applied the following resolutions and checked their consistency against the acceptance criteria. This records the first critique and its resolutions; it is not a second independent verdict on the revised text. (basis: independent local spec critique and your confirmed resolution choice.)

| Finding | Applied resolution |
| :--- | :--- |
| Expiry missing from some child and mutation paths | One parent guard applies across task and nested routes. Check the database clock after locks, prioritize expiry over conflicts, and return no expired content. Cleanup alone deletes expired tasks |
| Old polls could arrive after a save | Resource generations, read sequences, and accepted revision floors reject stale callbacks. Mutation settlement invalidates affected projections and starts a fresh read |
| Error status alone could not choose recovery | A shared code, status, latest payload, and next action table distinguishes conflicts, lifecycle, validation, auth, configuration, storage, and timeout cases |
| Moving ordering keys left page cache behavior unclear | Keep one live page without merged page contents. Explicit refresh and local membership changes restart traversal. Navigation through changing data has eventual consistency |
| Canonical rich text and emptiness were underspecified | A named shared format defines permitted keys, children, defaults, mark order, adjacent text, empty arrays, and exactly which documents become null |
| Global configuration checks could disable unrelated routes | Validate variables per data, auth, cleanup, and migration capability, with isolated imports |
| First migration could not supply assigned tags | Initial task queries return an explicit empty array without touching future tables. Apply the later migration before deploying assignment joins |
| Tag rename changed task presentation without task revision | Independently versioned tag labels refresh by tag ID and revision, preserving task drafts and their bases |
| Revision overflow had no recovery | Keep the integer representation, guard increments, return a controlled maintenance error, and require a reviewed widening migration before further increments |
| Cleanup backlog value looked like a count | Define `purged` as a number and `remainingEligible` as a boolean |

The single page behavior avoids adding snapshot storage or collection revision infrastructure for this personal release. The explicit traversal limitation is a deliberate consistency choice. Retaining integer revisions also avoids a new string encoded revision interface for a boundary far beyond the expected personal workload, while defining safe behavior if it is reached. (basis: confirmed recommended fixes, small personal workload, optimistic concurrency control.)

You confirmed the revised spec on 2026-11-03. The linked feature's design step is complete. Its spec remains Proposed until implementation begins, as required by the feature lifecycle.

## Research evidence and limits

The architecture research ran on 2026-11-03, using five search queries and eight opened pages from official sources. A separate approved skill and MCP discovery pass inspected registries and official repositories. GPT 6.1 Sol with low reasoning was used at your request because the skill's default Claude research provider was disabled.

| Area | Established | Not established |
| :--- | :--- | :--- |
| Drizzle and Better Auth | Drizzle and Prisma adapters exist, auth schema generation is supported, driver transaction modes differ | Exact mutually compatible package versions and adapter transaction defaults |
| Identity IDs | Better Auth IDs are strings by default; explicit UUID configuration changes generated column types | No reason to change the default identity ID policy for this feature |
| Freshness | You accepted three second polling | Neon native live query APIs were outside the page budget; no claim that Neon lacks live capabilities |
| Rich text | Tiptap JSON, input validation, and React integration are documented | Exact React 19.3 compatibility for the eventual pinned editor version |
| Cleanup | Hobby supports daily schedules and bearer secret protection; suspended compute limits `pg_cron` | A hard timing guarantee, free Neon Function Trigger quotas, or guaranteed free capacity for your eventual usage |
| Unicode | The product needs normalized case insensitive tag uniqueness | No npm folding package was evaluated. The spec instead defines a pinned Unicode algorithm and source mapping as an implementation asset |

The cited pages are evidence for human readers. They were checked during discovery and are not a request for later workflow agents to fetch them again.

## Skill and MCP inventory

The six selected skills were installed into `.agents/skills/` and recorded in `skills-lock.json`. All were confirmed in their source repositories before selection. Their instructions inform the build contract, but installation did not provision a database, install application dependencies, run migrations, or deploy anything. (basis: installed skill files and `skills-lock.json`.)

| Installed skill | Verified source | Relevance |
| :--- | :--- | :--- |
| `neon-postgres` | [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills) | Runtime pooling and direct migrations |
| `neon-drizzle` | [neondatabase/ai-rules](https://github.com/neondatabase/ai-rules) | Schema and migration workflow |
| `better-auth-best-practices` | [better-auth/skills](https://github.com/better-auth/skills) | Adapter, schema generation, sessions |
| `better-auth-security-best-practices` | [better-auth/skills](https://github.com/better-auth/skills) | Secrets, origin checks, serverless auth limits |
| `tiptap` | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Document schema, package version alignment, rendering |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Safe serialization, small payloads, independent parallel reads |

**MCP outcome**: deferred by your choice, not permanently declined. No stack specific service tools were connected. The approved search found these candidates. No connection or write scope was granted. (basis: confirmed tool discovery choice.)

| Candidate | Verified source | Access notes |
| :--- | :--- | :--- |
| Next Devtools | [vercel/next-devtools-mcp](https://github.com/vercel/next-devtools-mcp) | Local development routes, errors, logs, and runtime information |
| Context7 | [upstash/context7](https://github.com/upstash/context7) | External documentation service, no inherent application database access; chosen version coverage untested |
| Neon | [neondatabase/mcp-server-neon](https://github.com/neondatabase/mcp-server-neon) | Project, branch, SQL, and migration tools; account authorization can permit writes |
| PostgreSQL | [YawLabs/postgres-mcp](https://github.com/YawLabs/postgres-mcp) | Community inspection and query tool, described as read only by default; requires credentials |
| Drizzle Kit | [Drizzle Kit MCP](https://orm.drizzle.team/docs/mysql/drizzle-kit-mcp) | Migration and schema tools, RC documentation; exact eventual version support unverified |
| Drizzle schema inspection | [Fredobumma/drizzle-mcp](https://github.com/Fredobumma/drizzle-mcp) | Community database and schema access, described as read only by default |
| Better Auth documentation | [Better Auth MCP](https://better-auth.com/docs/ai-resources/mcp) | Documentation and examples, no established application user administration |
| Vercel | [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp) | Documentation, deployment and project tools, logs; account tools can permit writes, Cron management unverified |

Discovery also found community skills for App Router, TypeScript, PostgreSQL, Drizzle migrations, and Tiptap, plus broader official setup and deployment skills. They were offered and were not selected. They are not treated as permanently declined. The unverified remote Drizzle documentation service and unrelated TipTap Games result were excluded. No additional registry search is needed for this decision.

## References

**Project sources**:

* `AGENTS.md`, installed Next.js guides `01-app/02-guides/data-security.md` and `01-app/01-getting-started/15-route-handlers.md`, and `package.json`, cited for stack and server boundaries.
* `docs/scope/scope.md`, cited for product intent, Tracer Bullet ordering, and Alpha workflow.
* Installed skill files listed above and `skills-lock.json`, cited for database, auth, editor, and React conventions.
* Confirmed design conversation, cited for requirements and explicit tool choices.
* Independent local spec critique by GPT 6.1 Terra and your approved resolution choice, cited for the cross check changes.

**Practices and standards**:

* Relational constraints and atomic transactions, cited for owner safe links and complete writes.
* Optimistic concurrency control, cited for atomic revision checks.
* Idempotency keys, cited for durable creation receipts.
* Unicode normalization and default case folding, cited for tag uniqueness. Unicode mapping provenance is named in the build contract; no unverified source URL is supplied.
* Derived value consistency, cited for deriving task status from progress.

**Links verified during research**:

* [Drizzle Neon connections](https://orm.drizzle.team/docs/connect-neon), cited for transaction mode distinctions.
* [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), cited for the chosen adapter and generated schema.
* [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma), cited for the alternative query layer.
* [Better Auth database and IDs](https://better-auth.com/docs/concepts/database), cited for identity ID types.
* [Tiptap content handling](https://tiptap.dev/docs/guides/output-json-html) and [React integration](https://tiptap.dev/docs/editor/getting-started/install/react), cited for the document format and rendering contract.
* [Vercel Cron usage limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [management and security](https://vercel.com/docs/cron-jobs/manage-cron-jobs), cited for daily cleanup and its bearer secret.
* [Neon pg_cron](https://neon.com/docs/extensions/pg_cron), cited for cleanup while compute can suspend.
* [Ably Free](https://ably.com/docs/platform/pricing/free), cited for the pushed notification alternative.
* Skill and MCP source links in the inventory tables, cited there for candidate provenance and access notes.
