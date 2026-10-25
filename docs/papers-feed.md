# Papers and the feed

Decided 2026-10-24 (fork issues [#8](https://github.com/code259/learnharness/issues/8), [#9](https://github.com/code259/learnharness/issues/9)). Both live in the Library: **Books / Papers / Feed** tabs (`/library?tab=`).

## Papers (#8)

**Records:** `data/library/papers/<id>/`
- `paper.json` (`PaperRecord`: title, authors, arXiv id, abstract, source, `format`, predictions);
- `paper.pdf` for PDFs, or `paper.md` for **articles** (web posts saved as readable text through `fetchReadable`).

`src/store/papers.ts`; `src/server/papers.ts` is the only writer.

**Adding** (`POST /api/papers`):
- **arXiv id or link:** metadata from the arXiv API, PDF from arxiv.org. An arXiv paper already on the shelf is returned, not re-added.
- **A PDF link**, a **PDF file**, or **an article link.**

**Paper sessions:** "Read it" at **Skim / Standard / Deep** starts a **normal teach session** (`ChatRecord.paperId`). Its message[0] is a `paper-context` marker with the paper, the depth's arc (`PAPER_ARCS`), and how to read it:
- PDF: `consult_book` with the paper's id, through `paperForConsult`, with cited pages;
- article: its text is embedded.

The prober measures the paper's prerequisites; the teacher follows the arc (`prompts/teacher/48-papers.md`): predict → fill gaps → derive → results vs prediction → critique. It never reveals results before the prediction.

**Predictions:**
- **Tools:** `record_prediction` (the learner's words and confidence, 50–99%, asked, never guessed) and `resolve_prediction` (held / partly / missed). They're registered only in paper sessions, and stored on the paper.
- **"Your predictions"** on the Papers tab shows the hit rate per 10-point confidence band (`calibrationBands`; partly = half), with a tick where a calibrated rate would sit.

## Feed (#9)

**Sources** (`src/server/feed-sources.ts`):
- the **arXiv API** (cs.LG / cs.CL / cs.AI, newest 300, filtered by `SAFETY_TERMS`);
- **RSS** for OpenAI, Google DeepMind, Redwood Research and METR;
- **listing pages** for Anthropic research, Anthropic Alignment Science, Apollo Research and UK AISI. These have no RSS, so article links are matched by path, and each new link is titled from its own page.

**Daily scan:**
- The app shell's `DailyFeedScan` posts `{action: "daily"}` on every window open; `ensureDailyFeedScan` runs at most once per calendar day. There's also **Refresh**.
- New items only: a seen-URL set (capped at 20k) means nothing is shown twice, and dated items must be ≤ 10 days old.

**Ranking:**
- `prefilter` scores word overlap with the learner's profile (active goals' statements and topics, field-map agendas, recent graph propositions) and keeps the top 30.
- **One cheap-model call** (`pickFeedItems`, the `librarian` role) picks ≤ 5, each with a one-line summary and **"why for you"**.
- Without a usable model, the prefilter's top 5 still appear, with a note.

**Forgiving:** items stay visible for **7 days** (`visibleFeedItems`). There's no unread count, and old picks drop out of the record on the next scan.

**Actions:**
- **Read it** (depth) → added as a paper plus a paper session;
- **Add to papers**;
- **Capture** → the inbox;
- **Dismiss**.

Source failures are skipped and named in the feed's note.
