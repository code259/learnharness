import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { dispatch, type JobToolContext } from "./jobs.ts";

/**
 * The session-side library tools (fork #15 — docs/library.md). Books are
 * REFERENCES, never the curriculum: these tools let an agent see what the
 * learner's library holds and read from a book when it genuinely helps —
 * nothing here can set a session's goal or plan.
 *
 *   list_books    PROBER + TEACHER — titles, pinned-for-this-goal marks,
 *                 chapter titles (vocabulary only)
 *   consult_book  TEACHER — a background read of the right pages, through
 *                 the existing PDF reader (a "pdf" job: same runner, same
 *                 cited brief, same card); the book's outline rides along
 *                 so the reader jumps straight to the pages
 */

export interface LibraryToolContext {
	/** The library listing for this session (server-built). */
	listBooks: () => string;
	/** Resolve a named book to its PDF + outline, or an error message. */
	resolveBook: (ref: string) => { title: string; outline: string; path: string } | string;
}

const listBooksInput = Type.Object({});

export function listBooksTool(ctx: Pick<LibraryToolContext, "listBooks">): Record<string, AgentTool<any>> {
	return {
		list_books: {
			name: "list_books",
			label: "list_books",
			description:
				"List the books in the learner's library: id, title, page count, whether it is pinned to this session's goal, and its chapter titles. " +
				"Vocabulary for what a topic involves — never a plan to follow.",
			parameters: listBooksInput,
			execute: serverExecute("list_books", listBooksInput, async () => ctx.listBooks()),
		},
	};
}

const consultInput = Type.Object({
	book: Type.String({ minLength: 1, description: "The book's library id (from list_books) or its title." }),
	question: Type.String({
		minLength: 1,
		description: "What you need from the book for the current step — the reader sees nothing else of the lesson.",
	}),
});

const CONSULT_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The book brief (with page citations) arrives as a new message when ready; teach from it and cite the book (section, page).";

export function consultBookTool(ctx: LibraryToolContext & JobToolContext): Record<string, AgentTool<any>> {
	return {
		consult_book: {
			name: "consult_book",
			label: "consult_book",
			description:
				"Read from a book in the learner's library when it genuinely helps the CURRENT step — the author's framing, a derivation, a precise definition. " +
				"A background reader finds the right pages and returns a cited brief (async, like pdf/research). A book is a reference, not the lesson plan: " +
				"never consult it just because it exists or is pinned.",
			parameters: consultInput,
			execute: serverExecute("consult_book", consultInput, (input, { toolCallId }) => {
				const book = ctx.resolveBook(input.book);
				if (typeof book === "string") return book;
				return dispatch(ctx, "pdf", toolCallId, CONSULT_ACK, {
					path: book.path,
					question:
						`${input.question}\n\nThe document is the book “${book.title}”. Its outline (PDF page numbers) — use it to go straight to the relevant pages:\n${book.outline}`,
				});
			}),
		},
	};
}
