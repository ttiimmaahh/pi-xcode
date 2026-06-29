import type * as acp from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DebugLogger } from "../types.js";

export type XcodeMcpTool = Awaited<
	ReturnType<Client["listTools"]>
>["tools"][number];

export interface ConnectedXcodeMcpServer {
	name: string;
	client: Client;
	tools: XcodeMcpTool[];
	close(): Promise<void>;
}

export async function connectXcodeMcpServer(
	server: acp.McpServer,
	cwd: string,
	logger: DebugLogger,
): Promise<ConnectedXcodeMcpServer | undefined> {
	if (!("command" in server)) {
		logger.log("Skipping non-stdio MCP server", {
			name: server.name,
			type: "type" in server ? server.type : "unknown",
		});
		return undefined;
	}

	const env = mergeEnvironment(server.env);
	const client = new Client({ name: "pi-xcode", version: "0.1.0" });
	const transport = new StdioClientTransport({
		command: server.command,
		args: server.args,
		env,
		cwd,
		stderr: "pipe",
	});

	transport.stderr?.on("data", (chunk: Buffer | string) => {
		logger.log("MCP server stderr", {
			server: server.name,
			text: String(chunk).slice(0, 2000),
		});
	});

	logger.log("Connecting MCP stdio server", {
		name: server.name,
		command: server.command,
		args: server.args,
		envNames: server.env.map((item) => item.name),
		cwd,
	});

	await client.connect(transport);
	logger.log("Connected MCP stdio server", {
		name: server.name,
		pid: transport.pid,
	});

	const tools = await listAllTools(client);
	logger.log("Listed MCP tools", {
		server: server.name,
		toolCount: tools.length,
		tools: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			annotations: tool.annotations,
		})),
	});

	return {
		name: server.name,
		client,
		tools,
		close: async () => {
			logger.log("Closing MCP server", { name: server.name });
			await client.close();
		},
	};
}

async function listAllTools(client: Client): Promise<XcodeMcpTool[]> {
	const allTools: XcodeMcpTool[] = [];
	let cursor: string | undefined;
	do {
		const result = await client.listTools(cursor ? { cursor } : undefined, {
			timeout: 5000,
		});
		allTools.push(...result.tools);
		cursor = result.nextCursor;
	} while (cursor);
	return allTools;
}

function mergeEnvironment(env: acp.EnvVariable[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) merged[key] = value;
	}
	for (const item of env) {
		merged[item.name] = item.value;
	}
	return merged;
}
