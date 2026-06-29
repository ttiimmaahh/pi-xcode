import type * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ExitPlanModeParams = Type.Object({
	plan: Type.String({
		description:
			"The complete markdown implementation plan to present for approval.",
	}),
});

export interface ExitPlanModeToolDetails {
	approved: boolean;
	selectedMode?: string;
}

export interface ExitPlanModeToolOptions {
	name?: string;
	getSessionId(): string | undefined;
	getConnection(): acp.AgentSideConnection | undefined;
	onApproved(sessionId: string): Promise<void> | void;
	onRejected(sessionId: string): Promise<void> | void;
}

export function createExitPlanModeTool(
	options: ExitPlanModeToolOptions,
): ToolDefinition<typeof ExitPlanModeParams, ExitPlanModeToolDetails> {
	return {
		name: options.name ?? "ExitPlanMode",
		label: "Exit Plan Mode",
		description:
			"Present the completed implementation plan to the user for approval before making code changes.",
		promptSnippet:
			"Use ExitPlanMode when a plan is ready. Pass the complete markdown plan in the plan argument and wait for user approval before implementing.",
		parameters: ExitPlanModeParams,
		executionMode: "sequential",
		async execute(toolCallId, params, signal) {
			if (signal?.aborted) throw new Error("ExitPlanMode aborted");
			const sessionId = options.getSessionId();
			const connection = options.getConnection();
			if (!sessionId || !connection) {
				throw new Error("ACP connection is not available for ExitPlanMode");
			}

			const response = await connection.requestPermission({
				sessionId,
				toolCall: createExitPlanModeToolCall(toolCallId, params.plan),
				options: [
					{
						optionId: "default",
						name: "Yes, implement this plan",
						kind: "allow_once",
					},
					{
						optionId: "plan",
						name: "No, keep planning",
						kind: "reject_once",
					},
				],
			});
			if (signal?.aborted) throw new Error("ExitPlanMode aborted");

			const selectedMode =
				response.outcome.outcome === "selected"
					? response.outcome.optionId
					: undefined;
			if (selectedMode !== "default") {
				await options.onRejected(sessionId);
				return {
					content: [
						{
							type: "text",
							text: "The user did not approve implementation. Stay in plan mode and refine the plan.",
						},
					],
					details: { approved: false, selectedMode },
				};
			}

			await options.onApproved(sessionId);
			return {
				content: [
					{
						type: "text",
						text: "The user approved the plan. Exit plan mode and implement the approved plan now.",
					},
				],
				details: { approved: true, selectedMode },
			};
		},
	};
}

export function createExitPlanModeToolCall(
	toolCallId: string,
	plan: string,
): acp.ToolCallUpdate {
	return {
		toolCallId,
		title: "Ready to code?",
		kind: "switch_mode",
		status: "pending",
		content: [
			{
				type: "content",
				content: { type: "text", text: plan },
			},
		],
		rawInput: { plan },
	};
}
