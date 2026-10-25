# Exercises and the progress page

Decided 2026-10-24 (fork issues [#11](https://github.com/code259/learnharness/issues/11) and [#12](https://github.com/code259/learnharness/issues/12)). External practice, suggested inside teaching sessions, plus one page that mirrors how your learning is going. Neither assigns anything or keeps score.

## Exercises (#11)

Exercises live **only inside teaching chats**. There is no exercises page and no queue.

- **The catalog** (`src/core/exercise-catalog.ts`) is a starting point, not a limit. It has verified links to:
  - ARENA (every part of chapters 0–4)
  - Stanford CS336 (assignments 1–5)
  - Karpathy's Zero to Hero
  - Deep-ML and StaffML
  - Sasha Rush's Tensor, GPU and Autodiff puzzles
  - LeetGPU

  `searchCatalog` ranks entries by word overlap (title words count double).
- **The teacher's tools** (`src/agent/tools/exercises.ts`, teacher only):
  - `find_exercises` searches the catalog. When nothing matches, the result tells the teacher to use research to find good exercises elsewhere.
  - `suggest_exercise` puts a card in the chat with a title, source, a real http(s) link and one line on why it fits.

  The prompt section (`prompts/teacher/49-exercises.md`) tells the teacher to:
  - suggest one to three exercises at a natural point;
  - never assign them, and never invent links;
  - work from what was hard when the learner talks one through.
- **The card** (`components/artifacts/exercise-card.tsx`) has **Done** and **Struggled** buttons, each with an optional note. After a Struggled mark, **Talk it through** sends a normal message to the teacher quoting the note.
  - Marks are stored in `data/exercises.json`, keyed by the suggestion's tool call.
  - `markExercise` reads the card's content from the session's own `suggest_exercise` call, so the client sends only the status and the note. A card that isn't in the session gets a 404.
  - Re-marking replaces the old mark.
- Deep-ML and StaffML have no public API, so tracking is manual: the marks on the cards.

## The progress page (#12)

**Progress** in the sidebar opens `/progress`. Everything on it is derived from what the other stores already hold (`getProgressView` in `src/server/progress.ts`); nothing new is stored, apart from the field map's coverage history below. The page has four sections:

1. **Knowledge growth.** The number of ideas in your knowledge graph, how many are new this week and this month, and a weekly line (`weeklyGrowth`). The line is cumulative: weeks with nothing new stay flat and never leave a gap.
2. **Goals & field.**
   - Each active goal's roadmap coverage.
   - "You know X of Y key concepts" on the field map, with a line of how that has changed. `checkCoverage` appends a snapshot to `FieldMapRecord.history`, capped at 400.
3. **Reading & taste.**
   - Papers read: distinct papers with a paper session, plus the session count.
   - Section coverage for each ready book.
   - The prediction calibration view from the reading room.
4. **Practice & activity.**
   - Exercises done and struggled with, and the recent marks.
   - An **activity calendar** of the last 26 weeks. A day is active when you sent a message or answered a question in any session. Active days are filled; every other day is a blank outline.

**No streaks, no "behind", no red** (see [forgiving-schedule.md](forgiving-schedule.md)). A day you didn't study is just a blank square.

Days and weeks use **local time**, because the server is your own machine: an evening session counts for that evening, not tomorrow's UTC date. Weeks start on Monday.

The page refetches on the relevant server events (turns, chats, goals, library, field map, papers, exercises).

Tests: `tests/exercises-progress.test.tsx`.
