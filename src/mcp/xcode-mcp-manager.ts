import type * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { connectXcodeMcpServer } from "./xcode-mcp-client.js";
import type { ConnectedXcodeMcpServer } from "./xcode-mcp-client.js";
import { adaptXcodeMcpTools } from "./xcode-mcp-tool-adapter.js";
import type { DebugLogger, PiXcodeOptions } from "../types.js";

export class XcodeMcpManager {
	private readonly connectedServers: ConnectedXcodeMcpServer[] = [];
	private readonly customTools: Array<ToolDefinition<any, any, any>> = [];

	private constructor(private readonly logger: DebugLogger) {}

	static async connect(
		mcpServers: acp.McpServer[] | undefined,
		cwd: string,
		options: PiXcodeOptions,
		logger: DebugLogger,
	): Promise<XcodeMcpManager | undefined> {
		if (options.noXcodeMcp) {
			logger.log("Xcode MCP disabled by --no-xcode-mcp");
			return undefined;
		}
		const stdioServers = (mcpServers ?? []).filter(
			(server) => "command" in server,
		);
		if (stdioServers.length === 0) return undefined;

		const manager = new XcodeMcpManager(logger);
		for (const server of stdioServers) {
			try {
				const connected = await connectXcodeMcpServer(server, cwd, logger);
				if (!connected) continue;
				manager.connectedServers.push(connected);
				const selectedTools = filterMcpTools(
					connected.tools,
					options.xcodeMcpTools,
					options.excludeXcodeMcpTools,
				);
				logger.log("Selected Xcode MCP tools", {
					server: connected.name,
					discoveredToolCount: connected.tools.length,
					selectedToolCount: selectedTools.length,
					allowlist: options.xcodeMcpTools,
					denylist: options.excludeXcodeMcpTools,
					selectedTools: selectedTools.map((tool) => tool.name),
					skippedTools: connected.tools
						.filter((tool) => !selectedTools.includes(tool))
						.map((tool) => tool.name),
				});
				manager.customTools.push(
					...adaptXcodeMcpTools(
						connected.name,
						connected.client,
						selectedTools,
						logger,
					),
				);
			} catch (error) {
				logger.error("Failed to connect MCP server", error);
			}
		}

		logger.log("MCP manager ready", {
			serverCount: manager.connectedServers.length,
			customToolCount: manager.customTools.length,
			customTools: manager.customTools.map((tool) => tool.name),
		});

		return manager.connectedServers.length > 0 ? manager : undefined;
	}

	getCustomTools(): Array<ToolDefinition<any, any, any>> {
		return this.customTools;
	}

	async dispose(): Promise<void> {
		const closePromises: Array<Promise<void>> = [];
		for (const server of this.connectedServers) {
			closePromises.push(this.closeServer(server));
		}
		await Promise.allSettled(closePromises);
		this.connectedServers.length = 0;
		this.customTools.length = 0;
	}

	private async closeServer(server: ConnectedXcodeMcpServer): Promise<void> {
		try {
			await server.close();
		} catch (error) {
			this.logger.error("Failed to close MCP server", error);
		}
	}
}

function filterMcpTools<TTool extends { name: string }>(
	tools: TTool[],
	allowlist: string[] | undefined,
	denylist: string[] | undefined,
): TTool[] {
	const allowed = allowlist ? new Set(allowlist) : undefined;
	const denied = new Set(denylist ?? []);
	return tools.filter((tool) => {
		if (allowed && !allowed.has(tool.name)) return false;
		if (denied.has(tool.name)) return false;
		return true;
	});
}
