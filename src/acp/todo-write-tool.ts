import type * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { planEntriesFromToolInput } from "./plan-progress.js";

const TodoWriteParams = Type.Object({
	todos: Type.Array(
		Type.Object({
			content: Type.String(),
			status: Type.Optional(Type.String()),
			priority: Type.Optional(Type.String()),
		}),
	),
});

export interface TodoWriteToolDetails {
	entries: acp.PlanEntry[];
}

export interface TodoWriteToolOptions {
	name?: string;
	getSessionId(): string | undefined;
	getConnection(): acp.AgentSideConnection | undefined;
}

export function createTodoWriteTool(
	options: TodoWriteToolOptions,
): ToolDefinition<typeof TodoWriteParams, TodoWriteToolDetails> {
	return {
		name: options.name ?? "TodoWrite",
		label: "Todo Write",
		description:
			"Update the current task list/plan progress. Use this to track multi-step work.",
		promptSnippet:
			"Use TodoWrite to keep a visible task list current during multi-step work. Provide todos with content and status pending, in_progress, or completed.",
		parameters: TodoWriteParams,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const entries = planEntriesFromToolInput("TodoWrite", params) ?? [];
			const sessionId = options.getSessionId();
			const connection = options.getConnection();
			if (sessionId && connection && entries.length > 0) {
				await connection.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "plan",
						entries,
					},
				});
			}
			return {
				content: [
					{
						type: "text",
						text:
							entries.length > 0
								? `Updated ${entries.length} todo${entries.length === 1 ? "" : "s"}.`
								: "No valid todos were provided.",
					},
				],
				details: { entries },
			};
		},
	};
}
