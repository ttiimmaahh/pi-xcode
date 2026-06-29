import type * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const EnterPlanModeParams = Type.Object({
	reason: Type.Optional(
		Type.String({
			description: "Why planning mode is needed before implementation.",
		}),
	),
});

export interface EnterPlanModeToolDetails {
	entered: boolean;
}

export interface EnterPlanModeToolOptions {
	name?: string;
	getSessionId(): string | undefined;
	onEnterPlanMode(sessionId: string): Promise<void> | void;
}

export function createEnterPlanModeTool(
	options: EnterPlanModeToolOptions,
): ToolDefinition<typeof EnterPlanModeParams, EnterPlanModeToolDetails> {
	return {
		name: options.name ?? "EnterPlanMode",
		label: "Enter Plan Mode",
		description:
			"Switch into read-only planning mode before making code changes.",
		promptSnippet:
			"Use EnterPlanMode when the user wants planning or when you need to design an approach before editing. Use ExitPlanMode when the final plan is ready for approval.",
		parameters: EnterPlanModeParams,
		executionMode: "sequential",
		async execute(_toolCallId, _params, signal) {
			if (signal?.aborted) throw new Error("EnterPlanMode aborted");
			const sessionId = options.getSessionId();
			if (!sessionId) {
				throw new Error("ACP session is not available for EnterPlanMode");
			}
			await options.onEnterPlanMode(sessionId);
			return {
				content: [
					{
						type: "text",
						text: "Plan mode is active. Explore read-only, ask clarifying questions if needed, then call ExitPlanMode with the complete markdown plan when ready for user approval.",
					},
				],
				details: { entered: true },
			};
		},
	};
}
