import type * as acp from "@agentclientprotocol/sdk";
import { ensureAbsolutePath } from "../util/paths.js";

export function toolDiffContent(
	toolName: string,
	args: unknown,
	result: unknown,
	cwd: string,
): acp.ToolCallContent[] | undefined {
	const input = asRecord(args);
	if (toolName === "edit") return editDiffContent(input, cwd);
	if (toolName === "write") return writeDiffContent(input, result, cwd);
	return undefined;
}

function editDiffContent(
	input: Record<string, unknown>,
	cwd: string,
): acp.ToolCallContent[] | undefined {
	if (typeof input.path !== "string" || !Array.isArray(input.edits))
		return undefined;
	const path = ensureAbsolutePath(input.path, cwd);
	const diffs = input.edits.flatMap((edit): acp.ToolCallContent[] => {
		const record = asRecord(edit);
		if (
			typeof record.oldText !== "string" ||
			typeof record.newText !== "string"
		) {
			return [];
		}
		return [
			{
				type: "diff",
				path,
				oldText: record.oldText,
				newText: record.newText,
			},
		];
	});
	return diffs.length ? diffs : undefined;
}

function writeDiffContent(
	input: Record<string, unknown>,
	result: unknown,
	cwd: string,
): acp.ToolCallContent[] | undefined {
	if (typeof input.path !== "string" || typeof input.content !== "string")
		return undefined;
	return [
		{
			type: "diff",
			path: ensureAbsolutePath(input.path, cwd),
			oldText: extractPreviousContent(result),
			newText: input.content,
		},
	];
}

function extractPreviousContent(result: unknown): string | null {
	const details = asRecord(asRecord(result).details);
	for (const key of [
		"oldText",
		"oldContent",
		"previousText",
		"previousContent",
	]) {
		const value = details[key];
		if (typeof value === "string") return value;
	}
	return null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}
