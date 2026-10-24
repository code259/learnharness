# The AI safety field map

Decided 2026-10-24 (fork issue [#10](https://github.com/code259/learnharness/issues/10)). A map of technical AI safety research agendas, overlaid with what you know. A mirror that informs what to learn next; it never drives anything.

## Building it

1. **Seed:** the [Shallow Review of Technical AI Safety 2025](https://github.com/arb-consulting/shallow-review-2025) agenda export (`agendas.csv`), **downloaded at build time** (`SEED_CSV_URL`) and **never committed**, since that repo carries no license.
   - `seedAreas` drops the Labs section (organizations, not learning content).
   - A section whose agendas *all* have a sub-section splits into those sub-sections (Black-box safety → Iterative alignment, Model psychology, Better data, Goal robustness). Otherwise the section is the area.
2. **Rewrite** (`describeArea`, the `librarian` role, cheap slot): per area, in the app's own words. Each agenda gets a summary, a theory of change, and 4–8 **key concepts**, written as short self-contained statements; these are what coverage measures. `seedName` keeps the link to the review.
3. **Refinement** (`refineMap`, a new `cartographer` role on the strong slot, with web search): checks the map against newer sources (the Singapore Consensus 2026, aisafetyagendas.com, lab research-direction posts, recent Alignment Forum and arXiv work) and submits add / edit / dormant / remove changes with reasons and source URLs.
   - On the **first build** these apply directly and are logged.
   - A refinement failure leaves the seed map standing, with a note to retry via Update.

## Growing it

**Update the map** runs the same refinement for changes since the last update. Its changes become **proposals** you **Accept** (applied by `applyProposal`, logged) or **Reject**. Nothing changes on its own. The header shows "updated …" quietly.

## Where you stand

The headline panel shows **per area, how much of its key concepts you know**:
- solid bar = known; light bar = partly known; counts on the right; sorted strongest first;
- **click an area** to see it per agenda, or **tick agendas** on the grid to compare a selection;
- dormant agendas are left out.

`standing` and `fieldTotals` in `src/core/fieldmap.ts` are pure, computed from the same coverage data as the tile shading.

**Coverage** reuses the library's judge (`ideaCandidates` + `judgeIdeas`) on agenda concepts. It's stored with the graph revision and rechecked **only when the map is viewed and stale**, plus a manual Recheck.

## Acting on it

From the agenda panel:
- **Learn this agenda:** a normal tailored session whose message[0] is an `agenda-context` marker. The prober still measures; the concept list is orientation, not a syllabus.
- **Add to a roadmap:** sends it to a goal's conversation.
- **Make it a goal:** `createGoalWithDraft`, a new goal whose roadmap is drafted right away.

## Storage and surfaces

- `data/fieldmap/map.json` (`FieldMapRecord`): areas, coverage, proposals, change log, sources. `src/server/fieldmap.ts` is the only writer, and every write emits `fieldmap-changed`.
- Routes:
  - `GET /api/field-map` (also triggers a stale recheck);
  - `POST /api/field-map {action: build | update | recheck}`;
  - `POST /api/field-map/proposals/[id]`;
  - `POST /api/field-map/agendas/[id]`.
- UI: the sidebar's **Field map** row → `/field-map` (`?agenda=<id>` opens that agenda's panel; the transcript's agenda card links there).
- Runs you click (Build, Update, Recheck) count as foreground for ChatGPT's background-use setting; only the automatic stale recheck counts as background.
