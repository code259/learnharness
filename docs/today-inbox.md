# Today, time budgets, and the inbox

Decided 2026-10-24 (fork issues [#2](https://github.com/code259/learnharness/issues/2), [#5](https://github.com/code259/learnharness/issues/5), [#6](https://github.com/code259/learnharness/issues/6)). Follows [forgiving-schedule.md](forgiving-schedule.md).

## Today panel (#2)

A collapsible panel at the tail of the graph home's top-right column, below the actions row, cost number, and pipeline pills (`components/today-panel.tsx`; `sideSlot` on `GraphView` / `MinimalHome`). Open/closed and the budget are remembered per viewer in `localStorage`.

The plan is **derived on every fetch** (`GET /api/today?budget=`, `src/server/today.ts` gathering inputs, `src/core/today.ts` pure folds). Nothing is stored, carried over, or overdue. Candidates, in priority order:

| Kind | Source | Estimate |
|---|---|---|
| Continue | the most recent teach session past the probe whose plan's goal node isn't reached (`sessionCoveredGoal`) | ~25 min |
| Next roadmap topic | the most recently active **active** goal's next available topic, skipping the one "Continue" already covers | ~45 min |
| Practice | up to 8 propositions born on the 7 most recent *active* days, started as a practice session with them as picks | ~15 min |
| Inbox | the newest open inbox item | ~20 min |

## Time budget (#5)

Chips: 15 / 30 / 60 / 120 min. `fillBudget` adds candidates in order while they fit, and the first item always shows. If the last session activity was **3+ days ago**, the first plan of a visit starts at 15 min (forgiving rule 6); after that, the learner's pick stands.

## Inbox and quick capture (#6)

- `data/inbox.json`, one small list (`src/store/inbox.ts`); the Today service is the only writer, and every write announces `inbox-changed`.
- Status: `open | started | sent | archived`. **Auto-archive is derived**: an open item untouched for 30 days reads as archived (`inboxArchived`). Restore resets its clock. No counts of waiting items are shown anywhere.
- **The inbox page** (`/inbox`, `components/inbox-page.tsx`, the sidebar's Inbox row) holds the whole list, so the Today panel only keeps a capture field and an "Open inbox" link. Two tabs:
  - **Inbox**: every open item.
  - **Archive**: items archived by hand or aged out, with Restore and **Delete forever** behind a confirm dialog. `DELETE /api/inbox/[id]` refuses non-archived items; an item must be archived first.
- Actions (`POST /api/inbox/[id]`):
  - `start` creates a teach session with the item as the first message;
  - `roadmap` sends "Consider adding this to the roadmap: …" to the goal's conversation;
  - `archive` and `restore`.
- **⌥⌘L**: a global hotkey registered by the Electron shell (`electron/main.cjs`). It opens a small always-on-top, frameless capture window on the display under the cursor, loading `/capture` (`components/capture-box.tsx`).
  - It is a trusted app window, so the desktop API header rides its calls, and it has the main window's navigation guards.
  - Enter saves and closes; Esc or losing focus closes.
  - If another app owns the shortcut, the shell logs that and the Today field still works.

## Later

Spaced reviews (#3), papers (#8), and external practice (#11) join the candidate list as new kinds with their own estimates.
