/**
 * Goals UI pins (fork #4): the sidebar's automatic goal folders (pure
 * grouping + the folder row) and the roadmap page's pure helpers (the
 * recommended next topic, the forgiving progress line — no dates, no
 * "behind"). Same tsx classic-JSX shim as render-sidebar.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalFolderRow, groupSessions } from "../components/sidebar.tsx";
import { nextTopic, progressLine } from "../components/goal-view.tsx";
import type { ChatListItem, GoalSummary, TopicView } from "../src/core/index.ts";

function chat(id: string, goalId?: string): ChatListItem {
	return {
		id,
		title: id,
		kind: "teach",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
		messageCount: 1,
		phase: "probe",
		pendingQuestion: false,
		pendingProblem: false,
		busy: false,
		compacting: false,
		...(goalId ? { goalTopic: { goalId, topicId: "t" } } : {}),
	};
}

function goal(id: string, over: Partial<GoalSummary> = {}): GoalSummary {
	return { id, title: `Goal ${id}`, status: "active", coveredCount: 2, totalCount: 9, updatedAt: "2026-10-01T00:00:00.000Z", working: false, ...over };
}

function topic(id: string, over: Partial<TopicView> = {}): TopicView {
	return { id, title: id, status: "not-started", available: false, prerequisites: [], sessions: [], ...over };
}

describe("sidebar goal folders", () => {
	it("groups linked sessions under their goal, in list order; the rest stay ungrouped", () => {
		const { folders, ungrouped } = groupSessions(
			[chat("a", "g1"), chat("b"), chat("c", "g2"), chat("d", "g1"), chat("e", "deleted-goal")],
			[goal("g1"), goal("g2")],
		);
		assert.deepEqual(folders.map((f) => [f.goal.id, f.chats.map((c) => c.id)]), [
			["g1", ["a", "d"]],
			["g2", ["c"]],
		]);
		assert.deepEqual(ungrouped.map((c) => c.id), ["b", "e"], "an unknown goal falls back to ungrouped");
	});

	it("the folder row links the roadmap and shows covered/total — or the spinner while the agent works", () => {
		const idle = renderToStaticMarkup(<GoalFolderRow goal={goal("g1")} open active={false} onToggle={() => {}} />);
		assert.ok(idle.includes('href="/goals/g1"'));
		assert.ok(idle.includes("2/9"));
		assert.ok(idle.includes('aria-expanded="true"'));
		const working = renderToStaticMarkup(<GoalFolderRow goal={goal("g1", { working: true })} open={false} active={false} onToggle={() => {}} />);
		assert.ok(!working.includes("2/9"));
		assert.ok(working.includes("Working"), "the braille spinner's label");
	});
});

describe("roadmap page helpers", () => {
	it("next topic: pick up an in-progress available topic first, else the first available", () => {
		assert.equal(nextTopic([topic("a", { available: true }), topic("b", { available: true, status: "in-progress" })])?.id, "b");
		assert.equal(nextTopic([topic("a"), topic("b", { available: true })])?.id, "b");
		assert.equal(nextTopic([topic("a", { status: "covered" })]), null);
	});

	it("progress line: counts, plus the active-week estimate when there is one — never a date", () => {
		assert.equal(progressLine({ coveredCount: 1, totalCount: 1, estimate: null }), "1 of 1 topic covered");
		assert.equal(
			progressLine({ coveredCount: 3, totalCount: 12, estimate: { remainingTopics: 9, activeWeeks: 5 } }),
			"3 of 12 topics covered · about 5 active weeks to go at your recent pace",
		);
	});
});
