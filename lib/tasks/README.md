# Task data integration

Your task routes use the real personal session. The server data modules live in `lib/data/tasks/`. The shared validators and in memory browser controllers live here. The final screens can consume them without another storage model.

## Client lifetime

You can keep `TaskController` instances outside a private view that unmounts during session expiry. Calling `start()` attaches polling, the leaving warning, and the auth draft guard. Calling `dispose()` releases those subscriptions. Disposal does not erase a draft, so you can reuse the instance after reauthentication. A confirmed sign out clears registered private state.

You can subscribe to a controller through its `changed` callback. Its `base`, `draft`, `latest`, `inFlight`, `state`, and `error` expose the saved version, local changes, conflict comparison, exact uncertain request, and save feedback. `savedView` becomes null for a missing or expired record. The draft remains available for copying. `unsupportedDescription` tells a screen to disable that format while keeping other fields editable.

`edit()` schedules valid task field changes after 750 milliseconds. `retry()` resends the exact failed request. `reapply()` is an explicit review action against `latest`. `discard()` deliberately drops local changes. `explicit()` handles assignments and lifecycle actions only after pending work is saved or discarded. You can ask for confirmation in the screen before calling the permanent deletion action.

`copyText()` exposes readable draft text. `copy()` tries the clipboard and opens a selectable text dialog if that is unavailable. You can also display `copyText()` directly in a screen.

## Displayed collections

You can use `LivePage` with `displayPage()` for one displayed page at a time. `next()`, `previous()`, and `fromStart()` own its cursor boundaries. Selection and draft controllers stay outside the page. You can read `error` and `loading` alongside the last successful page.

`observeResource()` shares visible reads for the same URL. Reads pause in hidden tabs or when auth is paused. A mutation invalidates earlier read generations across displayed resources. Revision floors prevent an older list or detail response from replacing a newer record. Tag labels have their own revision map, available through `currentTag(id)` even while a task draft stays dirty.

You can use `RecordEditor` for explicit tag rename and comment edits. Its `start(sourcePath)` takes the currently displayed paginated collection URL, since tags and comments have collection GET routes. The screen can also call `receive()` with a saved record from that collection. You can release its observation and call `dispose()` when that editor is no longer needed.

`CreationRequest` retains one payload and UUID key through explicit retries. Its `dispose()` releases its draft guard. `ExplicitDeletion` retains the expected revision through retries for tags or comments. Assignment and task lifecycle writes use the task controller queue.

## Database and checks

The shared history contains auth migration 0000, task and receipt migration 0001, and tag and comment migration 0002. You can apply compatible additions with `npm run db:migrate` before deploying routes that query them. Generation and migration do not need the runtime auth or Cron settings.

The `tasks:prove-*` commands exercise the development database or client controllers. The database scripts require `AUTH_PROOF_DEVELOPMENT=true`. `tasks:prove-api` additionally needs an existing real Google session. They create temporary proof data and remove it afterward. The contract proof calls real cleanup, which can remove other already expired tasks on that development database.

Tag normalization uses common and full mappings from Unicode 15.1.0 `CaseFolding.txt`, generated into `case-fold-15.1.json`. You can review the source at https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt and its license at https://www.unicode.org/license.txt. A future mapping change needs collision detection and a reviewed migration.

Task maintenance uses `/api/internal/tasks/cleanup` at `0 2 * * *` UTC. The existing auth schedule stays at `0 3 * * *`. Both use the privately configured `CRON_SECRET`. Runtime task access does not require that secret or the migration URL.
