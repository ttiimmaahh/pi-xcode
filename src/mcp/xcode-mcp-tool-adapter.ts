import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { XcodeMcpTool } from "./xcode-mcp-client.js";
import type { DebugLogger } from "../types.js";

type PiToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

interface XcodeMcpToolDetails {
	server: string;
	tool: string;
	isError?: boolean;
	structuredContent?: unknown;
	rawResult: unknown;
}

export function adaptXcodeMcpTools(
	serverName: string,
	client: Client,
	tools: XcodeMcpTool[],
	logger: DebugLogger,
): ToolDefinition<TSchema, XcodeMcpToolDetails>[] {
	return tools.map((tool) => ({
		name: tool.name,
		label: tool.annotations?.title ?? tool.name,
		description: tool.description ?? `Xcode MCP tool: ${tool.name}`,
		promptSnippet: tool.description ?? `Use ${tool.name} through Xcode MCP.`,
		parameters: asTypeBoxSchema(tool.inputSchema),
		prepareArguments: (args) => asRecord(args),
		executionMode: tool.annotations?.destructiveHint
			? "sequential"
			: "parallel",
		async execute(_toolCallId, params, signal, onUpdate) {
			const input = asRecord(params);
			const startedAt = Date.now();
			logger.log("Calling Xcode MCP tool", {
				server: serverName,
				tool: tool.name,
				params: input,
			});

			onUpdate?.({
				content: [{ type: "text", text: `Calling Xcode tool ${tool.name}…` }],
				details: {
					server: serverName,
					tool: tool.name,
					rawResult: undefined,
				},
			});

			let result: Awaited<ReturnType<Client["callTool"]>>;
			try {
				result = await client.callTool(
					{ name: tool.name, arguments: input },
					undefined,
					{
						signal,
						timeout: 60000,
						resetTimeoutOnProgress: true,
						maxTotalTimeout: 600000,
						onprogress: (progress) => {
							onUpdate?.({
								content: [
									{
										type: "text",
										text: `Xcode tool ${tool.name} progress: ${progress.progress}${progress.total === undefined ? "" : `/${progress.total}`}`,
									},
								],
								details: {
									server: serverName,
									tool: tool.name,
									rawResult: progress,
								},
							});
						},
					},
				);
			} catch (error) {
				logger.error("Xcode MCP tool call failed", {
					server: serverName,
					tool: tool.name,
					durationMs: Date.now() - startedAt,
					error: serializeError(error),
				});
				throw error;
			}

			logger.log("Xcode MCP tool result", {
				server: serverName,
				tool: tool.name,
				durationMs: Date.now() - startedAt,
				isError: "isError" in result ? result.isError : undefined,
				result: summarizeMcpResult(result),
			});

			if ("isError" in result && result.isError) {
				throw new Error(mcpResultToText(result) || `${tool.name} failed`);
			}

			return {
				content: mcpResultToPiContent(result),
				details: {
					server: serverName,
					tool: tool.name,
					isError:
						"isError" in result && typeof result.isError === "boolean"
							? result.isError
							: undefined,
					structuredContent:
						"structuredContent" in result
							? result.structuredContent
							: undefined,
					rawResult: result,
				},
			};
		},
	}));
}

function asTypeBoxSchema(schema: XcodeMcpTool["inputSchema"]): TSchema {
	if (schema && typeof schema === "object" && schema.type === "object") {
		return schema as unknown as TSchema;
	}
	return {
		type: "object",
		properties: {},
		additionalProperties: true,
	} as unknown as TSchema;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function mcpResultToPiContent(
	result: Awaited<ReturnType<Client["callTool"]>>,
): PiToolContent[] {
	if ("content" in result && Array.isArray(result.content)) {
		const mapped: PiToolContent[] = result.content.flatMap(
			(item): PiToolContent[] => {
				if (item.type === "text")
					return [{ type: "text" as const, text: item.text }];
				if (item.type === "image") {
					return [
						{
							type: "image" as const,
							data: item.data,
							mimeType: item.mimeType,
						},
					];
				}
				if (item.type === "resource") {
					return [
						{
							type: "text" as const,
							text:
								"text" in item.resource
									? item.resource.text
									: `[Binary resource: ${item.resource.uri}]`,
						},
					];
				}
				return [{ type: "text" as const, text: JSON.stringify(item) }];
			},
		);
		if (mapped.length > 0) return mapped;
	}
	if ("toolResult" in result) {
		return [{ type: "text", text: stringifyUnknown(result.toolResult) }];
	}
	if ("structuredContent" in result && result.structuredContent) {
		return [{ type: "text", text: stringifyUnknown(result.structuredContent) }];
	}
	return [{ type: "text", text: stringifyUnknown(result) }];
}

function mcpResultToText(
	result: Awaited<ReturnType<Client["callTool"]>>,
): string {
	return mcpResultToPiContent(result)
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

function summarizeMcpResult(result: unknown): unknown {
	if (typeof result !== "object" || result === null) return result;
	const record = result as Record<string, unknown>;
	return {
		...record,
		content: Array.isArray(record.content)
			? record.content.map((item) =>
					typeof item === "object" &&
					item !== null &&
					"text" in item &&
					typeof (item as { text?: unknown }).text === "string"
						? {
								...item,
								text: truncate((item as { text: string }).text, 500),
							}
						: item,
				)
			: record.content,
	};
}

function stringifyUnknown(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function serializeError(error: unknown): unknown {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return error;
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
