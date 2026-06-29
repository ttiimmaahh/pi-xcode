import type * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	applyAskUserQuestionResponse,
	askUserQuestionsToElicitationRequest,
	extractAskUserQuestions,
	formatAskUserQuestionAnswers,
} from "./ask-user-question.js";

const AskUserQuestionParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			question: Type.String(),
			header: Type.Optional(Type.String()),
			multiSelect: Type.Optional(Type.Boolean()),
			options: Type.Array(
				Type.Object({
					label: Type.String(),
					description: Type.Optional(Type.String()),
					preview: Type.Optional(Type.String()),
				}),
			),
		}),
	),
});

export interface AskUserQuestionToolDetails {
	answers: Record<string, string>;
}

export interface AskUserQuestionToolOptions {
	name?: string;
	getSessionId(): string | undefined;
	getConnection(): acp.AgentSideConnection | undefined;
}

export function createAskUserQuestionTool(
	options: AskUserQuestionToolOptions,
): ToolDefinition<typeof AskUserQuestionParams, AskUserQuestionToolDetails> {
	return {
		name: options.name ?? "ask_user_question",
		label: "Ask User",
		description:
			"Ask the user one or more structured questions when their input is needed before continuing.",
		promptSnippet:
			"Use AskUserQuestion to ask concise structured questions when user input is required.",
		parameters: AskUserQuestionParams,
		executionMode: "sequential",
		async execute(toolCallId, params, signal) {
			if (signal?.aborted) throw new Error("AskUserQuestion aborted");
			const sessionId = options.getSessionId();
			const connection = options.getConnection();
			if (!sessionId || !connection) {
				throw new Error("ACP connection is not available for AskUserQuestion");
			}

			const questions = extractAskUserQuestions(params);
			if (questions.length === 0) {
				return {
					content: [
						{ type: "text", text: "No valid questions were provided." },
					],
					details: { answers: {} },
				};
			}

			const result = await askWithElicitationIfAvailable(
				connection,
				sessionId,
				toolCallId,
				questions,
			);
			if (signal?.aborted) throw new Error("AskUserQuestion aborted");
			if (result.cancelled) throw new Error("AskUserQuestion cancelled");
			return {
				content: [
					{
						type: "text",
						text: formatAskUserQuestionAnswers(result.answers),
					},
				],
				details: { answers: result.answers },
			};
		},
	};
}

async function askWithElicitationIfAvailable(
	connection: acp.AgentSideConnection,
	sessionId: string,
	toolCallId: string,
	questions: ReturnType<typeof extractAskUserQuestions>,
): Promise<{ cancelled: boolean; answers: Record<string, string> }> {
	try {
		const response = await connection.unstable_createElicitation(
			askUserQuestionsToElicitationRequest(questions, sessionId, toolCallId),
		);
		return applyAskUserQuestionResponse(response, questions);
	} catch (error) {
		if (!isUnsupportedMethodError(error)) throw error;
	}

	return {
		cancelled: false,
		answers: {
			"Manual response needed": formatManualQuestionPrompt(questions),
		},
	};
}

function formatManualQuestionPrompt(
	questions: ReturnType<typeof extractAskUserQuestions>,
): string {
	const rendered = questions
		.map((question, questionIndex) => {
			const options = question.options
				.map((option, optionIndex) => {
					const description = option.description
						? ` — ${option.description}`
						: "";
					return `${optionIndex + 1}. ${option.label}${description}`;
				})
				.join("\n");
			const prefix = questions.length > 1 ? `${questionIndex + 1}. ` : "";
			const multi = question.multiSelect ? " (select one or more)" : "";
			return `${prefix}${question.question}${multi}\n${options}`;
		})
		.join("\n\n");
	return `Rich Q&A UI is not available for this custom ACP agent yet. Ask the user to answer manually in chat, then continue after they reply.\n\n${rendered}`;
}

function isUnsupportedMethodError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/method not supported|not supported by client|method not found/i.test(
			error.message,
		)
	);
}
