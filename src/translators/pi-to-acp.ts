import type * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { toolDiffContent } from "../acp/diff-artifacts.js";
import { planEntriesFromToolInput } from "../acp/plan-progress.js";
import { ensureAbsolutePath } from "../util/paths.js";

type SessionUpdate = acp.SessionNotification["update"];

export function piEventToAcpUpdates(
	sessionId: string,
	event: AgentSessionEvent,
	cwd: string,
): acp.SessionNotification[] {
	const update = piEventToAcpUpdate(event, cwd);
	return update ? [{ sessionId, update }] : [];
}

function piEventToAcpUpdate(
	event: AgentSessionEvent,
	cwd: string,
): SessionUpdate | undefined {
	switch (event.type) {
		case "message_update":
			return messageUpdateToAcp(event);
		case "tool_execution_start": {
			const planEntries = planEntriesFromToolInput(event.toolName, event.args);
			if (planEntries) return { sessionUpdate: "plan", entries: planEntries };
			return {
				sessionUpdate: "tool_call",
				toolCallId: event.toolCallId,
				title: toolTitle(event.toolName, event.args),
				kind: toolKind(event.toolName),
				status: "pending",
				locations: extractLocations(event.toolName, event.args, cwd),
				rawInput: event.args,
			};
		}
		case "tool_execution_update": {
			const content =
				toolDiffContent(event.toolName, event.args, event.partialResult, cwd) ??
				toolResultContent(event.partialResult);
			return {
				sessionUpdate: "tool_call_update",
				toolCallId: event.toolCallId,
				status: "in_progress",
				content,
				locations: extractLocations(event.toolName, event.args, cwd),
				rawInput: event.args,
				rawOutput: event.partialResult,
			};
		}
		case "tool_execution_end":
			return {
				sessionUpdate: "tool_call_update",
				toolCallId: event.toolCallId,
				status: event.isError ? "failed" : "completed",
				content: toolResultContent(event.result),
				rawOutput: event.result,
			};
		default:
			return undefined;
	}
}

function messageUpdateToAcp(
	event: Extract<AgentSessionEvent, { type: "message_update" }>,
): SessionUpdate | undefined {
	const messageEvent = event.assistantMessageEvent;
	if (messageEvent.type === "text_delta") {
		return {
			sessionUpdate: "agent_message_chunk",
			messageId: messageIdFromPartial(messageEvent.partial),
			content: { type: "text", text: messageEvent.delta },
		};
	}

	if (messageEvent.type === "error") {
		const error = messageEvent.error as { errorMessage?: string };
		return {
			sessionUpdate: "agent_message_chunk",
			messageId: messageIdFromPartial(messageEvent.error),
			content: {
				type: "text",
				text: `Pi error: ${error.errorMessage ?? "model request failed"}`,
			},
		};
	}

	return undefined;
}

function messageIdFromPartial(partial: unknown): string | undefined {
	if (
		typeof partial === "object" &&
		partial !== null &&
		"timestamp" in partial
	) {
		const timestamp = (partial as { timestamp?: unknown }).timestamp;
		if (typeof timestamp === "number" || typeof timestamp === "string")
			return `assistant-${timestamp}`;
	}
	return undefined;
}

export function toolKind(toolName: string): acp.ToolKind {
	switch (toolName) {
		case "read":
			return "read";
		case "write":
		case "edit":
			return "edit";
		case "bash":
			return "execute";
		case "grep":
		case "find":
		case "ls":
			return "search";
		default:
			return "other";
	}
}

function toolTitle(toolName: string, args: unknown): string {
	const input = asRecord(args);
	if (toolName === "bash" && typeof input.command === "string")
		return `Run: ${truncate(input.command, 80)}`;
	if (
		(toolName === "read" || toolName === "write" || toolName === "edit") &&
		typeof input.path === "string"
	) {
		return `${capitalize(toolName)} ${input.path}`;
	}
	if (toolName === "grep" && typeof input.pattern === "string")
		return `Search: ${input.pattern}`;
	if (toolName === "find" && typeof input.pattern === "string")
		return `Find: ${input.pattern}`;
	if (toolName === "ls" && typeof input.path === "string")
		return `List ${input.path}`;
	return capitalize(toolName.replace(/[_-]+/g, " "));
}

function extractLocations(
	_toolName: string,
	args: unknown,
	cwd: string,
): acp.ToolCallLocation[] | undefined {
	const input = asRecord(args);
	const candidate =
		typeof input.path === "string"
			? input.path
			: typeof input.file === "string"
				? input.file
				: undefined;
	if (!candidate) return undefined;
	return [{ path: ensureAbsolutePath(candidate, cwd) }];
}

function toolResultContent(result: unknown): acp.ToolCallContent[] | undefined {
	const content = asRecord(result).content;
	if (!Array.isArray(content)) return undefined;

	const mapped = content.flatMap((item): acp.ToolCallContent[] => {
		const record = asRecord(item);
		if (record.type === "text" && typeof record.text === "string") {
			return [
				{ type: "content", content: { type: "text", text: record.text } },
			];
		}
		if (
			record.type === "image" &&
			typeof record.data === "string" &&
			typeof record.mimeType === "string"
		) {
			return [
				{
					type: "content",
					content: {
						type: "image",
						data: record.data,
						mimeType: record.mimeType,
					},
				},
			];
		}
		return [];
	});

	return mapped.length > 0 ? mapped : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function capitalize(value: string): string {
	return value.length === 0
		? value
		: `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
