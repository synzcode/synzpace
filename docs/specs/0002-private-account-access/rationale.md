# Private account access rationale

## Context

You need one private dashboard account on your devices. Your tasks already have a planned ownership contract, but the repository has no sign in implementation. Without an access decision, task persistence cannot prove its first real signed in path.

You want closed enrollment, remembered devices, a way to revoke access everywhere, and recovery that preserves existing work. You control the application and its database. You do not need collaboration, profiles, a public registration service, or an application activity history.

The application is a small Next.js web project with Cache Components enabled. Delivery uses Tracer Bullet slices and Alpha verification. Existing decisions select Better Auth, Neon, Drizzle, Node.js, and Vercel. This record is a separate feature decision and preserves the task storage contract.

No regulated workflow was identified in the personal task scope. Email, session addresses, and credentials still require explicit handling. The local Git repository has no remote, so team freshness could not be checked.

## Options considered

### Option 1: Closed Google access with verified local provisioning

A local command proves the Google identity, obtains your confirmation, and creates the stable user and account binding. Better Auth handles ordinary sign in and sessions. This is the chosen option.

**Pros**: reuses your selected library and database, avoids another password, and provides a precise recovery path without changing task ownership.

**Cons**: requires a local OAuth command and Google client configuration. You must retain operator access to recover from a lost Google account.

### Option 2: Bind an identity ID obtained separately

The setup command accepts a provider subject you verified elsewhere.

**Pros**: the command needs less browser flow logic and can operate in an environment without a browser.

**Cons**: obtaining the right subject is a separate error prone task. A mistyped or unverified identifier can bind access to the wrong account. You chose verification inside the command instead.

### Option 3: Create the account on the first matching Google sign in

An allowlisted verified identity creates the user during the first deployed sign in.

**Pros**: fewer operator steps and no separate provisioning browser listener.

**Cons**: keeps a deployed enrollment path and makes the first callback a provisioning event. You explicitly chose to establish the account before normal sign in.

### Option 4: Dedicated password or inbox based sign in

Use a dashboard password, or send a sign in link or code through email.

**Pros**: a password avoids dependence on Google during sign in. Inbox access can avoid a remembered password.

**Cons**: a password adds credential management; inbox flows add a delivery service and another failure path. Neither fits your chosen existing identity experience as closely.

## Rationale

One Google identity gives you familiar daily access while keeping the application responsible for its own session lifetime and revocation. A verified local command makes the enrollment boundary explicit. Recovery changes that binding, rather than replacing the user referenced by your tasks.

The 30 day renewal window favors trusted personal devices. Renewal is limited to once per day to avoid writes on every poll. A 90 day cap prevents activity from extending the same dashboard session indefinitely. A seven day renewal window was the shorter runner up; you chose convenience with explicit revocation available.

Live database checks preserve the existing task contract. Cookie identity caching would add a revocation delay, so it is not used. Native fetch and a small shared controller match the existing task data approach. A separate data client or Redis service would add dependencies without a current need.

Shared Neon counters keep attempt limits consistent across functions. The application wrapper owns an atomic counter operation because separate reads and writes can lose increments under concurrency, and library storage hooks vary by version. Counters commit outside auth transactions so failed authentication cannot undo its attempt record. Redis is the runner up if measured auth traffic later justifies it.

Provisioning, callback processing, recovery, renewal, and global revocation share a transaction boundary. Deleting pending proofs closes the race where an old flow might otherwise issue a new session after a revoke. Transaction advisory locks fit Neon's pooled connection model; session advisory locks do not.

Google's maintained Node library supplies the local token exchange and signature verification. The alternative local Better Auth instance would reuse a package but require more setup specific lifecycle behavior. Normal auth continues to use Better Auth, so this choice does not introduce a second dashboard session system.

You chose a separate Account access page rather than placing all controls directly on the starter home. It gives sign out actions a stable location while the dashboard shell remains a separate feature.

You chose a locked view and explicit Retry when revocation is unconfirmed. A known server failure avoids deliberately clearing the cookie. Response loss cannot guarantee cookie retention because the browser can process deletion headers before the application sees a body. Device retry therefore accepts an absent cookie, and uncertain global revocation may require sign in and renewed confirmation.

Private content begins behind a browser gate rather than in server rendered page payloads. A server cannot read a local pending intent, so merely hiding streamed content would not preserve the chosen lock after reload. Separate immutable intent keys let tabs create and complete their own operations without a shared flag race.

The first auth slice owns auth schema and counters. Task persistence adds its tables in later migrations. This gives one migration history a clear order without duplicate auth DDL.

## Cross check disposition

An independent GPT 6.1 Terra pass with high reasoning found seven material issues. You approved the following targeted resolutions. This records design changes, not a claim that implementation capabilities have already been proved.

| Finding | Resolution |
| :--- | :--- |
| Cookie retention after response loss | Treat the cookie as present or cleared; retain the lock and use the appropriate retry or reauthentication path |
| Private content streamed before the pending lock | Generic initial HTML and React Server Component payloads, then browser gating before private JSON fetches |
| Races between tab intent updates | One immutable UUID key per operation; completion removes only its matching key, with global scope taking precedence |
| Unproved library integration | Explicit capability matrix before feature expansion; application owned atomic limiter; return unsupported capabilities to design |
| Missing source for the original destination | Page entry pathname and search parameters for redirects; original tab location for reauthentication |
| Unbounded callback parameters and errors | Total and per value byte limits, strict decoding, duplicate rejection, and fixed safe reason mapping |
| Conflicting migration ownership | Auth creates the first migration; task and receipt tables follow, then tags and comments |

You confirmed the revised design on 2026-11-03 after these changes. Scope feature 8 now links the five build milestones. The feature remains unbuilt and the spec remains Proposed; the first integration capability proof still belongs to implementation.

## Discovery inventory

Discovery ran on 2026-11-03 using GPT 6.1 Sol with low reasoning, as you requested after the skill's Claude helper proved unavailable. The pass was read only. No dedicated credible skill or MCP server for `google-auth-library` was confirmed. That is a search result, not a claim that none can exist.

Installed auth, Neon, Drizzle, Tiptap, and React performance skills were excluded from new installation offers. You chose to keep the installed skills only for now and defer extra MCP connections. These are deferrals, not permanent declines.

| Technology | Additional skill offered |
| :--- | :--- |
| Node.js | `wshobson/agents@nodejs-backend-patterns` |
| TypeScript | `wshobson/agents@typescript-advanced-types` |
| Next.js | `wshobson/agents@nextjs-app-router-patterns` |
| React | `vercel-labs/agent-skills@vercel-composition-patterns` |
| Tailwind 4 | `lombiq/tailwind-agent-skills@tailwind-4-docs` |
| Tailwind patterns | `wshobson/agents@tailwind-design-system` |
| Tailwind and shadcn | `secondsky/claude-skills@tailwind-v4-shadcn`, with Vite examples needing adaptation |
| Base UI | `secondsky/claude-skills@base-ui-react` |
| shadcn | `shadcn-ui/ui@shadcn` |
| Vercel | `vercel-labs/agent-skills@deploy-to-vercel` |

| MCP candidate | Purpose and limit |
| :--- | :--- |
| Next Devtools | Local routes, errors, and runtime information |
| Context7 | Library documentation, exact version coverage not established |
| Neon MCP | Project, branch, SQL, and migration access; authorization can permit writes |
| YawLabs Postgres MCP | Community query and inspection tools; credentials and permissions need review |
| Drizzle Kit MCP | Schema and migration tools; RC documentation and eventual package support need review |
| Fredobumma Drizzle MCP | Community schema inspection; permissions need review |
| Better Auth documentation MCP | Auth documentation and examples; no established user administration capability |
| Vercel MCP | Projects, deployments, and logs; authorization can permit writes |
| Official shadcn MCP | Component registry search and retrieval; installation can modify a project |

No connected service tools for this stack were found in the available tool metadata. No service connection is required by this design. References and source links are omitted as you requested.
