# Forgiving schedule — no-debt rules

Decided 2026-10-24 (fork issue [#1](https://github.com/code259/learnharness/issues/1)).
Every habit feature — Today queue (#2), spaced review (#3), goals and
roadmaps (#4), effort modes (#5), inbox (#6), weekly retro (#7), frontier
feed (#9), progress dashboard (#12) — must satisfy these rules. Review new
features against this list before merging.

## The principle

**Missing a day, or a week, never creates debt.** The app adapts to the time
actually spent; it never asks the learner to catch up.

## Rules

1. **Nothing is ever overdue.** Today's plan is generated fresh from current
   state each time. There is no carried-over checklist and no "overdue",
   "late", or "behind" state anywhere in the UI.
2. **Fixed daily review cap.** Spaced reviews are limited to a daily maximum
   the learner sets in Settings.
3. **Overflow waits silently.** When more reviews are eligible than the cap
   allows, each day picks the most valuable ones (most at risk of fading,
   tied to active goals). The rest stay in the pool and compete again next
   time. Nothing is deleted, and no count of waiting items is shown.
4. **Missed days: neutral facts only.** Activity views may show inactive days
   as blank (never red or otherwise marked). No counts, messages, or
   summaries about skipped days or skipped work — including in the weekly
   retro and the dashboard.
5. **No streaks.** No streak counter of any kind. Consistency is visible only
   through the activity calendar and totals.
6. **Returning after a gap is lighter, not special.** There is no
   welcome-back screen. The first Today plan after a gap is automatically
   sized down (Quick-sized) and focused on the most important faded items.
7. **Goals have no deadlines.** Roadmaps show progress and an estimated
   finish based on recent pace. The estimate just moves when the learner is
   away; it is never framed as being behind.
8. **Partial work is complete work.** Any amount done counts as a full day.
   Stopping a session early or doing a shorter plan is never marked partial
   or unfinished.
