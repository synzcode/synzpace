# Scope: Synzspace personal dashboard

Your private dashboard gives you a sidebar and a task management page as its first feature. You can capture work, organize it, and track progress in one place.

**Build approach:** Tracer Bullet (prove one real path through sign in, saved tasks, and device sync, then add each feature through every layer).
**Workflow:** Alpha (after `/develop`, verify the behavior in the real app with `/check verify`). This is your chosen default. A feature with an unresolved design decision still starts with `/architect`.

These are recommendations. You can change the order, depth, or scope as your needs become clearer.

## Confirmed scope

Your answers establish the following first release boundary. All planned slices below belong to this release.

* This dashboard is for your personal daily use, with private sign in and synced tasks across your devices.
* The main view is a table. A detail panel contains the full task description and comments.
* Each task has a title, description, status, tags, an optional due date, and progress you enter from 0 to 100 percent.
* Comments are personal entries with timestamps. You can add, edit, and delete them.
* You can search titles, filter by status and tags, and sort the list.
* The interface uses English, supports desktop and phone layouts, and provides keyboard access, visible focus, labeled controls, and status information that does not depend on color alone.
* There is no fixed deadline. Sharing, reminders, attachments, analytics, and extra dashboard pages are deferred.
* Keep this scope free of references.

## Design boundaries

Success means you can sign in, create a real task, open it on another device, find it, update its progress, and record a comment. Tasks, tags, and comments remain private to your account.

Recommended starting rules are a required title, an optional description, and the statuses To do, In progress, and Done. Status and progress consistency, sign in and recovery methods, sync timing, conflicting edits, and connection failure behavior remain design decisions. Device sync does not yet imply offline editing or live updates. No provider or storage technology is selected by this scope.

There is no billing or public marketing site in this personal release. No budget or performance limits have been specified. The design can set practical limits for one person's task list.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Existing visual theme | Foundation | existing |
| 2 | Task data and persistence | Foundation | in-progress |
| 3 | Dashboard shell and sidebar | Foundation | planned |
| 8 | Private account access | Slice 1 | in-progress |
| 4 | Saved task management | Slice 1 | planned |
| 5 | Task tags | Slice 2 | planned |
| 6 | Task search, filters, and sorting | Slice 3 | planned |
| 7 | Task comments | Slice 4 | planned |

## Foundations

### 1. Existing visual theme · existing

Your project already has a visual theme, reusable button styles, and a theme preview page. Reuse these as the dashboard's visual starting point.

**Done when:** the existing theme provides colors, typography, surfaces, and a component preview. This records current code, not a completed accessibility or production review.

Code in `app/globals.css`, `app/design-system/page.tsx`, and `components/ui/button.tsx`.

### 2. Task data and persistence · in-progress

Define how your task information is represented, owned, and saved before the page depends on it. Support private access across your devices from the start.

**Done when:** a design defines account ownership of tasks, tags, and comments; identifier and timestamp rules; due date semantics; status and progress consistency; private read and write access; and how saved data is loaded, changed, and handled when storage fails or its format changes.

- [x] Design it (spec): `/architect task data and persistence`

Spec: [0001](../specs/0001-task-data-persistence/index.md).

**Dependency:** private account access needs an approved design and a real session before the first signed in task proof. The recommended next decision is `/architect private account access`.

- [ ] Build it: `/develop task data and persistence`
  - [ ] Prove private task creation and reading across devices with real ownership and safe creation retries. Covers AC-1, AC-2, AC-3, AC-10, AC-13.
  - [ ] Add validated rich text, autosave, device refresh, and draft preserving conflict and failure recovery. Covers AC-3, AC-4, AC-7, AC-8, AC-9, AC-14.
  - [ ] Extend the same data path to tags, comments, and bounded lists. Covers AC-2, AC-5, AC-6, AC-8, AC-9, AC-10, AC-14.
  - [ ] Add trash recovery and expiry cleanup, then close compatibility and operational checks. Covers AC-9, AC-10, AC-11, AC-12, AC-13, AC-14.
Code in `lib/db/schema/tasks.ts`, `drizzle/0001_many_the_hunter.sql`, and `scripts/tasks/prove-schema.ts` (task and creation receipt schema applied and confirmed live; bounds, defaults, receipt retention, and account cascade proved with rolled back data. Routes and client logic remain pending. First signed in task proof waits for the account access device proof).

- [ ] Verify it: `/check verify task data and persistence`

### 3. Dashboard shell and sidebar · planned · needs a decision

Give your dashboard a consistent frame using the existing theme. Task management is the first functional sidebar destination and the default page.

**Done when:** after sign in you land on task management, the sidebar identifies the active destination, and navigation works with a keyboard and on a phone without covering task controls. Additional pages can be added later without displaying dead links now.

- [ ] Design it (spec): `/architect dashboard shell and sidebar`

## Slice 1: Real private task loop

The first slice proves the full path: sign in, create a task, save it to your account, and read it from another device. Account access and saved tasks form one working loop, rather than separate demonstrations. Later slices extend this same real data path.

### 8. Private account access · in-progress

Sign in privately from your devices so your task information belongs to you. This enables personal access, not collaboration or public account enrollment.

**Done when:** you can sign in and sign out on your devices; signed out access cannot read or change your information; access is restricted to the intended personal account; and expired sessions, failed sign in, and recovery follow defined behavior. Private access is enforced where data is read and written.

- [x] Design it (spec): `/architect private account access`

Spec: [0002](../specs/0002-private-account-access/index.md).

- [ ] Build it: `/develop private account access`
  - [ ] Prove the pinned auth integration, local setup, and closed Google sign in on two devices. Covers AC-1, AC-2, AC-3, AC-11, AC-13, AC-14.
  - [x] Add remembered sessions and separate tab reauthentication behind the private content gate. Covers AC-3, AC-4, AC-8, AC-9, AC-14.
  - [x] Complete device and global sign out with concurrent tab handling and locked failure recovery. Covers AC-5, AC-6, AC-8, AC-9, AC-10, AC-11, AC-14.
  - [ ] Prove local account recovery while preserving the user ID and task ownership. Covers AC-1, AC-2, AC-6, AC-7, AC-10, AC-12, AC-14.
  - [ ] Complete bounded maintenance, configuration isolation, and migration and operational checks. Covers AC-11, AC-12, AC-13, AC-14.
Code in `app/sign-in/`, `app/account/access/`, `app/api/`, `components/auth/`, `lib/auth/`, `lib/db/`, `drizzle/`, and `scripts/auth/` (real Google callback passed; permanent pages, session gate, sign out, recovery, and bounded cleanup implemented; database and controller proofs plus initial HTML and RSC privacy checks passed; recovery preserves task ownership and content through retry, capability configuration isolation passed with a real session and direct maintenance calls, overlapping cleanup and concurrent renewal passed, and HTTP callback plus HTML and RSC privacy checks passed again; you reported successful sign in in Safari and Chrome and global sign out ending access in both browsers; physical second device and live replacement identity checks, hosted Cron configuration, and deployed operational verification remain).

- [ ] Verify it: `/check verify private account access`


### 4. Saved task management · planned · needs a decision

Create, read, edit, and delete your tasks from a table and detail panel. Track each task through its title, description, status, due date, and progress, with changes saved to your account across devices.

**Done when:** you can manage tasks and retrieve saved changes after a reload and from a second signed in device; blank titles and invalid percentages are rejected; dates and status changes follow agreed rules; and empty, invalid input, connection failure, and conflicting edit states offer a clear next action without silently losing edits. Sync timing and conflict rules are defined and verified.

- [ ] Design it (spec): `/architect saved task management`

## Slice 2: Task organization

### 5. Task tags · planned · needs a decision

Organize tasks with reusable labels so related work is easy to recognize and find.

**Done when:** you can create tags and add or remove multiple tags on a task; tags and assignments persist across your devices within your account; and duplicate names and tag changes follow defined rules.

- [ ] Design it (spec): `/architect task tags`

## Slice 3: Find and order tasks

### 6. Task search, filters, and sorting · planned · needs a decision

Find the work you need without scanning the entire task list. Build this after saved tasks and tags so the controls work on real data.

**Done when:** title search and status and tag filters work together on your saved tasks; you can clear them; sorting supports title, due date, status, and progress with defined tie and missing date behavior; and a list with no matches explains how to reset the controls. Search results remain restricted to your account.

- [ ] Design it (spec): `/architect task search filters and sorting`

## Slice 4: Personal task history

### 7. Task comments · planned · needs a decision

Keep dated personal updates on each task without replacing its description.

**Done when:** you can add, edit, and delete nonempty comments in task details; comments show timestamps in a defined order, remain private and attached to the correct task across your devices, and follow the agreed task deletion rule.

- [ ] Design it (spec): `/architect task comments`

## Deferred

These six areas are outside the current build pass. They can be enrolled as features if you choose to expand the dashboard.

* **Sharing:** collaborators, assignments, and shared discussions.
* **Reminders:** notifications about upcoming and overdue work.
* **Attachments:** files and images on tasks.
* **Analytics:** usage tracking and reporting.
* **Further dashboard pages:** additional functional sidebar destinations.
* **Further task views and structure:** a board, a calendar, subtasks, and calculated progress.

## Legend

* **Next step:** the first unticked checkbox in the first unfinished feature, in the order above.
* **Needs a decision:** a design choice remains. The single entry checkbox recommends `/architect` before implementation. No design is approved by this scope alone.
* **Feature shape:** after design, `/architect` links its spec and adds the build command, two to five build milestones, and the checks required by the workflow. Detailed build tasks stay in the spec.
* **Statuses:** `planned` means queued, `in-progress` means work has started, `done` means the selected closing checks have passed or you have accepted completion, and `existing` records work that predates this plan. `dropped` preserves a feature removed from the plan.
* **Workflow:** Alpha suggests `/check verify` after `/develop`. A different tier beside a feature heading overrides that default. There is no separate test suite or model review stage by default.
* **Pointers:** the design step adds a spec link. Implementation adds code pointers. Existing pointers above describe the current project.
