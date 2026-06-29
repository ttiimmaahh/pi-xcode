import { describe, expect, it } from "vitest";
import { createAskUserQuestionTool } from "../src/acp/ask-user-question-tool.js";
import { createEnterPlanModeTool } from "../src/acp/enter-plan-mode-tool.js";
import {
	createExitPlanModeTool,
	createExitPlanModeToolCall,
} from "../src/acp/exit-plan-mode-tool.js";
import { createTodoWriteTool } from "../src/acp/todo-write-tool.js";
import { createWebSearchTool } from "../src/acp/web-search-tool.js";
import {
	applyAskUserQuestionResponse,
	askUserQuestionsToElicitationRequest,
	extractAskUserQuestions,
	formatAskUserQuestionAnswers,
} from "../src/acp/ask-user-question.js";
import { toolDiffContent } from "../src/acp/diff-artifacts.js";
import { describeResourceLink } from "../src/acp/inline-context.js";
import { planEntriesFromToolInput } from "../src/acp/plan-progress.js";
import { piEventToAcpUpdates } from "../src/translators/pi-to-acp.js";

describe("AskUserQuestion ACP elicitation bridge", () => {
	it("uses the snake_case Pi tool name by default", async () => {
		const tool = createAskUserQuestionTool({
			getSessionId: () => "session-1",
			getConnection: () =>
				({
					unstable_createElicitation: async () => ({
						action: "accept",
						content: { question_0: "Concise" },
					}),
				}) as never,
		});
		expect(tool.name).toBe("ask_user_question");
		const result = await tool.execute(
			"tool-1",
			{
				questions: [
					{
						question: "Style?",
						options: [{ label: "Concise" }, { label: "Detailed" }],
					},
				],
			},
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details?.answers).toEqual({ "Style?": "Concise" });
	});

	it("falls back to manual chat instructions when elicitation is unavailable", async () => {
		const tool = createAskUserQuestionTool({
			getSessionId: () => "session-1",
			getConnection: () =>
				({
					unstable_createElicitation: async () => {
						throw new Error(
							"Method not supported by client: elicitation/create",
						);
					},
				}) as never,
		});
		const result = await tool.execute(
			"tool-1",
			{
				questions: [
					{
						question: "Style?",
						options: [
							{ label: "Concise", description: "Short" },
							{ label: "Detailed", description: "More context" },
						],
					},
				],
			},
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details?.answers["Manual response needed"]).toContain(
			"Rich Q&A UI is not available",
		);
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : "",
		).toContain("Style?");
	});

	it("converts structured questions to an ACP form and folds accepted answers back", () => {
		const questions = extractAskUserQuestions({
			questions: [
				{
					question: "Which implementation should we use?",
					header: "Approach",
					options: [
						{ label: "Simple", description: "Lowest risk" },
						{ label: "Advanced", description: "More complete" },
					],
				},
			],
		});

		const request = askUserQuestionsToElicitationRequest(
			questions,
			"session-1",
			"tool-1",
		);
		expect(request).toMatchObject({
			mode: "form",
			sessionId: "session-1",
			toolCallId: "tool-1",
			message: "Which implementation should we use?",
		});
		if (request.mode !== "form") throw new Error("Expected form elicitation");
		expect(request.requestedSchema.properties?.question_0).toMatchObject({
			type: "string",
			title: "Approach",
			oneOf: [
				{ const: "Simple", title: "Simple — Lowest risk" },
				{ const: "Advanced", title: "Advanced — More complete" },
			],
		});

		const result = applyAskUserQuestionResponse(
			{ action: "accept", content: { question_0: "Advanced" } },
			questions,
		);
		expect(result).toEqual({
			cancelled: false,
			answers: { "Which implementation should we use?": "Advanced" },
		});
		expect(formatAskUserQuestionAnswers(result.answers)).toContain(
			"Answer: Advanced",
		);
	});
});

describe("EnterPlanMode ACP bridge", () => {
	it("activates plan mode and returns planning instructions", async () => {
		let enteredSession: string | undefined;
		const tool = createEnterPlanModeTool({
			getSessionId: () => "session-1",
			onEnterPlanMode: (sessionId) => {
				enteredSession = sessionId;
			},
		});
		const result = await tool.execute(
			"tool-1",
			{},
			undefined,
			undefined,
			{} as never,
		);
		expect(enteredSession).toBe("session-1");
		expect(result.details).toEqual({ entered: true });
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : "",
		).toContain("Plan mode is active");
	});
});

describe("ExitPlanMode ACP switch-mode bridge", () => {
	it("creates the switch_mode tool call shape Xcode expects", () => {
		expect(createExitPlanModeToolCall("tool-1", "# Plan")).toEqual({
			toolCallId: "tool-1",
			title: "Ready to code?",
			kind: "switch_mode",
			status: "pending",
			content: [{ type: "content", content: { type: "text", text: "# Plan" } }],
			rawInput: { plan: "# Plan" },
		});
	});

	it("returns implementation instructions when the user approves", async () => {
		let approvedSession: string | undefined;
		const tool = createExitPlanModeTool({
			getSessionId: () => "session-1",
			getConnection: () =>
				({
					requestPermission: async () => ({
						outcome: { outcome: "selected", optionId: "default" },
					}),
				}) as never,
			onApproved: (sessionId) => {
				approvedSession = sessionId;
			},
			onRejected: () => undefined,
		});
		const result = await tool.execute(
			"tool-1",
			{ plan: "# Plan" },
			undefined,
			undefined,
			{} as never,
		);
		expect(approvedSession).toBe("session-1");
		expect(result.details).toEqual({ approved: true, selectedMode: "default" });
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : "",
		).toContain("implement the approved plan");
	});
});

describe("diff artifacts", () => {
	it("maps edit tool input to ACP diff content", () => {
		const content = toolDiffContent(
			"edit",
			{ path: "src/App.swift", edits: [{ oldText: "old", newText: "new" }] },
			{},
			"/work/project",
		);
		expect(content).toEqual([
			{
				type: "diff",
				path: "/work/project/src/App.swift",
				oldText: "old",
				newText: "new",
			},
		]);
	});
});

describe("TodoWrite ACP plan bridge", () => {
	it("sends ACP plan updates for Claude-compatible TodoWrite calls", async () => {
		const updates: unknown[] = [];
		const tool = createTodoWriteTool({
			getSessionId: () => "session-1",
			getConnection: () =>
				({
					sessionUpdate: async (notification: unknown) => {
						updates.push(notification);
					},
				}) as never,
		});
		const result = await tool.execute(
			"tool-1",
			{ todos: [{ content: "Implement", status: "in_progress" }] },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details?.entries).toEqual([
			{ content: "Implement", priority: "medium", status: "in_progress" },
		]);
		expect(updates).toEqual([
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan",
					entries: [
						{ content: "Implement", priority: "medium", status: "in_progress" },
					],
				},
			},
		]);
	});
});

describe("WebSearch compatibility alias", () => {
	it("keeps Claude-style WebSearch calls from falling through as unknown tools", async () => {
		const tool = createWebSearchTool();
		expect(tool.name).toBe("WebSearch");
		const result = await tool.execute(
			"tool-1",
			{ query: "Xcode ACP agents", allowed_domains: ["developer.apple.com"] },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details).toEqual({
			query: "Xcode ACP agents",
			allowedDomains: ["developer.apple.com"],
			blockedDomains: undefined,
		});
		expect(
			result.content[0]?.type === "text" ? result.content[0].text : "",
		).toContain("native web_search tool");
	});
});

describe("plan progress", () => {
	it("maps todo-like tool input to ACP plan entries", () => {
		const entries = planEntriesFromToolInput("TodoWrite", {
			todos: [
				{ content: "Read existing code", status: "completed" },
				{
					content: "Implement change",
					status: "in_progress",
					priority: "high",
				},
			],
		});
		expect(entries).toEqual([
			{
				content: "Read existing code",
				priority: "medium",
				status: "completed",
			},
			{ content: "Implement change", priority: "high", status: "in_progress" },
		]);
	});

	it("emits ACP plan updates instead of generic tool calls for todo tools", () => {
		const notifications = piEventToAcpUpdates(
			"session-1",
			{
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "TodoWrite",
				args: { todos: [{ content: "Step 1", status: "pending" }] },
			} as never,
			"/work/project",
		);
		expect(notifications).toEqual([
			{
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan",
					entries: [
						{ content: "Step 1", priority: "medium", status: "pending" },
					],
				},
			},
		]);
	});
});

describe("inline context", () => {
	it("preserves file line metadata from resource links", () => {
		expect(
			describeResourceLink({
				name: "App.swift",
				uri: "file:///work/project/App.swift",
				_meta: { line: 42, endLine: 45 },
			}),
		).toContain("@/work/project/App.swift:42-45");
	});
});
