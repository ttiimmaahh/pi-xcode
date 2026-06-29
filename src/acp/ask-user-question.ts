import type * as acp from "@agentclientprotocol/sdk";

export interface AskUserQuestionInput {
	questions?: AskUserQuestion[];
}

export interface AskUserQuestion {
	question: string;
	header?: string;
	multiSelect?: boolean;
	options: AskUserQuestionOption[];
}

export interface AskUserQuestionOption {
	label: string;
	description?: string;
	preview?: string;
}

const OPTION_META_KEY = "_pi/askUserQuestionOption";

export function extractAskUserQuestions(input: unknown): AskUserQuestion[] {
	const questions = asRecord(input).questions;
	if (!Array.isArray(questions)) return [];
	return questions.flatMap((question): AskUserQuestion[] => {
		const record = asRecord(question);
		const options = Array.isArray(record.options)
			? record.options.flatMap((option): AskUserQuestionOption[] => {
					const optionRecord = asRecord(option);
					if (typeof optionRecord.label !== "string") return [];
					return [
						{
							label: optionRecord.label,
							description:
								typeof optionRecord.description === "string"
									? optionRecord.description
									: undefined,
							preview:
								typeof optionRecord.preview === "string"
									? optionRecord.preview
									: undefined,
						},
					];
				})
			: [];
		if (typeof record.question !== "string" || options.length === 0) return [];
		return [
			{
				question: record.question,
				header: typeof record.header === "string" ? record.header : undefined,
				multiSelect: record.multiSelect === true,
				options,
			},
		];
	});
}

export function askUserQuestionsToElicitationRequest(
	questions: AskUserQuestion[],
	sessionId: string,
	toolCallId: string,
): acp.CreateElicitationRequest {
	const single = questions.length === 1;
	const properties: Record<string, acp.ElicitationPropertySchema> = {};
	for (const [index, question] of questions.entries()) {
		const options = question.options.map(optionToEnumOption);
		const description = single ? undefined : question.question;
		const title = question.header || undefined;
		properties[questionFieldKey(index)] = question.multiSelect
			? {
					type: "array",
					title,
					description,
					items: { anyOf: options },
				}
			: { type: "string", title, description, oneOf: options };
		properties[questionCustomFieldKey(index)] = {
			type: "string",
			title: "Other",
			description:
				"Type your own answer instead of choosing an option above (optional).",
		};
	}

	return {
		mode: "form",
		sessionId,
		toolCallId,
		message: single
			? (questions[0]?.question ?? "Please answer the question.")
			: "Please answer the following questions.",
		requestedSchema: {
			type: "object",
			properties,
		},
	};
}

export function applyAskUserQuestionResponse(
	response: acp.CreateElicitationResponse,
	questions: AskUserQuestion[],
): { cancelled: boolean; answers: Record<string, string> } {
	if (response.action === "cancel") return { cancelled: true, answers: {} };
	if (response.action === "decline") return { cancelled: false, answers: {} };

	const content = response.content ?? {};
	const answers: Record<string, string> = {};
	for (const [index, question] of questions.entries()) {
		const custom = content[questionCustomFieldKey(index)];
		if (typeof custom === "string" && custom.trim()) {
			answers[question.question] = custom.trim();
			continue;
		}

		const value = content[questionFieldKey(index)];
		if (value === undefined || value === null) continue;
		const answer = Array.isArray(value) ? value.join(", ") : String(value);
		if (answer) answers[question.question] = answer;
	}
	return { cancelled: false, answers };
}

export function formatAskUserQuestionAnswers(
	answers: Record<string, string>,
): string {
	const entries = Object.entries(answers);
	if (entries.length === 0) return "The user skipped the question.";
	return entries
		.map(([question, answer]) => `Question: ${question}\nAnswer: ${answer}`)
		.join("\n\n");
}

function optionToEnumOption(option: AskUserQuestionOption): acp.EnumOption {
	const detail: { description?: string; preview?: string } = {};
	if (option.description) detail.description = option.description;
	if (option.preview) detail.preview = option.preview;
	const meta = Object.keys(detail).length
		? { [OPTION_META_KEY]: detail }
		: undefined;
	return {
		const: option.label,
		title: option.description
			? `${option.label} — ${option.description}`
			: option.label,
		...(meta ? { _meta: meta } : {}),
	};
}

function questionFieldKey(index: number): string {
	return `question_${index}`;
}

function questionCustomFieldKey(index: number): string {
	return `question_${index}_custom`;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}
