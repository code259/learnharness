# Goals and roadmaps

Decided 2026-10-24 (fork issue [#4](https://github.com/code259/learnharness/issues/4)). Follows the no-debt rules in [forgiving-schedule.md](forgiving-schedule.md).

## What it is

A **goal** is a long-term learning target that takes many sessions ("technical AI safety research", "LLMs end to end"). Its **roadmap** is a DAG of **topics**. Each topic is one session's goal: about one to a few teaching sessions' worth.

| | Session plan (`plan_init`) | Roadmap |
|---|---|---|
| Lives | one session | months |
| A node is | a proposition or landmark inside a lesson | a topic, which is one session's goal |
| Measured by | the prober's per-strand bracketing | coarse: the knowledge graph plus probe notes |
| Progress | quiz `nodeId` tags in the transcript | derived from the sessions linked to each topic |

The roadmap reuses the plan's machinery: the `PlanTree` shape (nodes are topics with a title and summary; `-->` means prerequisite), `createTree` validation, and the mermaid authoring format. The session engine (probe, plan, teach, extraction) is unchanged. A roadmap only chooses a session's goal and reads its results back.

## Flows

1. **Offer.** In an unlinked teach session, the prober makes the goal concrete. If it turns out to span many sessions, the prober asks (`ask_user_question`) whether the learner wants a roadmap. On yes, it calls `offer_roadmap`. That creates the goal with a one-topic seed map (this session's topic), links the session to it, and fires the background draft. The probe then continues for the first topic only.
2. **Draft and revise.** The roadmap agent (`src/agent/subagents/roadmapper.ts`) is an isolated sub-agent on the strong slot (role `roadmapper`). Its tools are `roadmap_write`, web search and fetch, and the knowledge-graph readers when graph tools are on. It rewrites the whole map, keeping the slugs of topics that already have sessions; the tool refuses to drop them. Three entry points share it: the first draft, a message from the roadmap page's conversation, and applying a suggestion. Runs are fire-and-forget and single-flight per goal. Liveness is held in a `globalThis` registry and announced via `goals-changed`; failures land in `lastError` with a retry.
3. **Start a topic.** From the roadmap page, this creates an ordinary teach session (model stamped from the strong slot). Its `message[0]` is the **goal-context marker** (`customType: "goal-context"`, following the graph-context precedent): the goal, the topic, and the roadmap's derived status lines. The prober treats the topic as the session goal and measures from there. The first learner message is the topic title plus summary, sent through the usual `/chat/<id>?prompt=` contract.
4. **Suggestions.** Linked sessions (prober and teacher) have `suggest_roadmap_change`. Suggestions wait on the roadmap page with Apply (the agent revises with it) or Dismiss. Nothing changes automatically.

## Progress (derived, never stored)

- **Covered**: a linked session asked a teach question tagged with a *sink* of its plan map, i.e. the session reached its goal node (`sessionCoveredGoal`, the existing position signal).
- **In progress**: a linked session exists. **Not started**: none exists.
- **Available**: not covered, and every prerequisite is covered.
- **Estimate**: covered topics per *active* week (a week with any linked-session activity), projected over the remaining topics. It's shown once two or more topics are covered. Idle weeks never count, so time away never makes a goal look behind.
- Sessions linked to a topic the map no longer has show as "sessions from removed topics".

## Storage and surfaces

- `data/goals/<id>.json` (`GoalRecord`: title, statement, status, roadmap, conversation, suggestions, lastError). The goals service is the only writer.
- `ChatRecord.goalTopic = { goalId, topicId }` links a session to a topic; the chat store stays the only writer of sessions.
- Routes: `GET /api/goals`; `GET/PATCH/DELETE /api/goals/[id]`; `POST /api/goals/[id]/messages`, `/redraft`, `/topics/[topicId]/start`, `/suggestions/[suggestionId]`.
- UI:
  - `/goals/[id]` (`components/goal-view.tsx`): the DAG via `PlanDiagram`, Next up, all topics, suggestions, and the conversation.
  - Sidebar goal folders: sessions group under their goal automatically, unlinked ones go under "Other sessions", and a search flattens everything.
  - The transcript's goal-context card and the roadmap-offer card.
- Deleting a goal unlinks its sessions (they return to the ungrouped list); the knowledge graph is untouched.

## Not here yet

- The Today queue (#2) and effort modes (#5) will read `available` topics across active goals.
- Spaced review (#3) is separate.
- The roadmap agent's token usage is not yet recorded in the cost meter.
