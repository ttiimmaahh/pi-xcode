import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WebSearchParams = Type.Object({
	query: Type.String(),
	allowed_domains: Type.Optional(Type.Array(Type.String())),
	blocked_domains: Type.Optional(Type.Array(Type.String())),
});

export interface WebSearchToolDetails {
	query: string;
	allowedDomains?: string[];
	blockedDomains?: string[];
}

export interface WebSearchToolOptions {
	name?: string;
}

export function createWebSearchTool(
	options: WebSearchToolOptions = {},
): ToolDefinition<typeof WebSearchParams, WebSearchToolDetails> {
	return {
		name: options.name ?? "WebSearch",
		label: "Web Search",
		description:
			"Claude-compatible alias that records a web search request for clients that expect WebSearch tool calls.",
		promptSnippet:
			"Prefer the native web_search tool for actual web research. WebSearch is available only as a compatibility alias when Claude-style prompts request it.",
		parameters: WebSearchParams,
		executionMode: "parallel",
		async execute(_toolCallId, params) {
			return {
				content: [
					{
						type: "text",
						text: `Use the native web_search tool to search for: ${params.query}`,
					},
				],
				details: {
					query: params.query,
					allowedDomains: params.allowed_domains,
					blockedDomains: params.blocked_domains,
				},
			};
		},
	};
}
