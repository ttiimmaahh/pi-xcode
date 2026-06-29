import type * as acp from "@agentclientprotocol/sdk";
import type { AskUserQuestion } from "./ask-user-question.js";

export function askUserQuestionToPermissionRequest(
	question: AskUserQuestion,
	sessionId: string,
	toolCallId: string,
): acp.RequestPermissionRequest {
	return {
		sessionId,
		toolCall: {
			toolCallId,
			title: question.header || "Ask user question",
			kind: "other",
			status: "pending",
			content: [
				{
					type: "content",
					content: { type: "text", text: formatPermissionQuestion(question) },
				},
			],
			rawInput: { question },
		},
		options: [
			...question.options.map(
				(option): acp.PermissionOption => ({
					optionId: option.label,
					name: option.label,
					kind: "allow_once",
				}),
			),
			{ optionId: "__skip__", name: "Skip", kind: "reject_once" },
		],
	};
}

export function answerFromPermissionResponse(
	response: acp.RequestPermissionResponse,
	question: AskUserQuestion,
): Record<string, string> {
	if (response.outcome.outcome !== "selected") return {};
	const optionId = response.outcome.optionId;
	if (optionId === "__skip__") return {};
	return { [question.question]: optionId };
}

function formatPermissionQuestion(question: AskUserQuestion): string {
	const options = question.options
		.map((option, index) => {
			const description = option.description ? ` — ${option.description}` : "";
			return `${index + 1}. **${option.label}**${description}`;
		})
		.join("\n");
	return `${question.question}\n\n${options}`;
}
