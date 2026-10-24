# The library: learning from books

Decided 2026-10-24 (fork issue [#15](https://github.com/code259/learnharness/issues/15)). Books are **references and yardsticks, never the curriculum.**

## Guardrail: never pigeonholed to the book

A pinned book never narrows the learning. Enforced in code and pinned in `tests/library.test.ts`:

- **Normal roadmaps never see book content.** `roadmapTaskFor` passes a normal goal's task through untouched. Only a "Study this book" goal (`followsBookId`) gets the outline.
- **Books reach a normal roadmap only through suggestions.** "Compare with my roadmap" runs the roadmap agent in **compare mode**, which has only `file_suggestion` (no `roadmap_write`) and at most 6 suggestions. You Apply or Dismiss each one.
- **Sessions:**
  - The prober gets `list_books`: titles, chapter names, and pinned marks only. Its prompt says the book never defines the goal or the strands.
  - The teacher's `consult_book` is "when it genuinely helps the current step". Pinned means *preferred when consulting*, not consulted more.
- **Coverage is shown, never acted on.** It doesn't feed Today, roadmaps, or nudges.
- **Following a book is opt-in only:** "Learn this section" (a `book-context` marker) or "Study this book".

## Pieces

**Storage**
- `data/library/<id>/` holds `book.pdf` (a copy) and `book.json` (`BookRecord`: chapters → sections → page ranges → key ideas, coverage, status).
- `src/store/library.ts`; `src/server/library.ts` is the only writer.

**Adding a book**
- `POST /api/library`: a multipart `file`, or `{ url }`. Limit 200 MB.
- `next.config.ts` raises `proxyClientMaxBodySize`, because the API proxy otherwise truncates bodies over 10 MB.

**Map build** (background, single-flight per book, resumable)
1. PDF bookmarks (`pdfOutline`) → `chaptersFromOutline`.
2. If there are fewer than 2 chapters: the librarian reads the table of contents (`outlineFromToc`). If there's still no structure: 20-page chunks.
3. Key ideas per section (`keyIdeas`, batched by size).
4. A first coverage pass.

The librarian is a new `librarian` role on the cheap slot.

**Coverage**
- Each section's ideas are judged against the knowledge graph (`judgeIdeas`).
- Candidates come from word overlap (`ideaCandidates`); an idea with no candidates is "not yet" without a model call.
- A section is covered at ≥ 75% (partly counts as half).
- Stored with the graph revision. It's rechecked **only when looked at and stale**: opening the book page, or a roadmap page with the book pinned. Held ideas stay held; **Recheck** re-judges everything.

**Sessions**
- `consult_book` dispatches a normal **`pdf` job** on the library copy, with the outline in the question, so the reader jumps to the right pages. Same runner, same cited brief, same card.
- `list_books` for the prober and teacher.
- Both appear only when the library has a ready book.

**Goals**
- `GoalRecord.bookIds` (pinned) and `followsBookId` ("Study this book").
- Book suggestions carry `bookId` and show "From <book>".

**UI**
- `/library` (sidebar row): add by file or link, list of books.
- `/library/[id]`:
  - the chapter/section map with coverage dots and per-idea marks;
  - Pin to a goal, Study this book, Recheck coverage, Delete (confirm dialog);
  - per section: Learn this section, Add to a roadmap.
- On the roadmap page: a "Pinned books" block with "Compare with my roadmap".

## Known gaps

- If the server restarts mid-`consult_book`, the job can't recover its input (the PDF job re-reads the transcript, whose arguments name the book, not the path). It fails gracefully as a PDF failure.
- Librarian token usage isn't in the cost meter yet (the same gap as the roadmap agent).
- PDF only; EPUB and web books are out of scope.
