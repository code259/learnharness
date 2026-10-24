/**
 * Today panel render pins (fork #2/#5): each row names its kind and its
 * estimate; the total is a plain "~N min" (never a target or a deadline).
 * Same tsx classic-JSX shim as render-sidebar.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayRow, totalLine } from "../components/today-panel.tsx";
import type { TodayItem } from "../src/core/index.ts";

const render = (item: TodayItem) => renderToStaticMarkup(<TodayRow item={item} busy={false} onRun={() => {}} />);

describe("Today panel rows", () => {
	it("continue / topic / practice / inbox each render their label, estimate, and subject", () => {
		const cont = render({ kind: "continue", minutes: 25, chatId: "c", title: "Backprop", goalTitle: "Safety" });
		assert.ok(cont.includes("Continue · ~25m") && cont.includes("Backprop") && cont.includes("Safety"));
		const topic = render({ kind: "topic", minutes: 45, goalId: "g", goalTitle: "Safety", topicId: "t", topicTitle: "Attention" });
		assert.ok(topic.includes("Next on your roadmap · ~45m") && topic.includes("Attention"));
		const practice = render({ kind: "practice", minutes: 15, picks: [{ id: "a", name: "A", statement: "S" }] });
		assert.ok(practice.includes("1 thing you learned recently"));
		const inbox = render({ kind: "inbox", minutes: 20, itemId: "i", text: "What is DPO?" });
		assert.ok(inbox.includes("From your inbox") && inbox.includes("What is DPO?"));
	});

	it("the total is approximate minutes, empty for an empty plan", () => {
		assert.equal(totalLine([]), "");
		assert.equal(
			totalLine([
				{ kind: "continue", minutes: 25, chatId: "c", title: "x" },
				{ kind: "practice", minutes: 15, picks: [] },
			]),
			"~40 min",
		);
	});
});
