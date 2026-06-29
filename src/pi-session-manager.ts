import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentSession,
	CreateAgentSessionFromServicesOptions,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type * as acp from "@agentclientprotocol/sdk";
import { XcodeMcpManager } from "./mcp/xcode-mcp-manager.js";
import type { PiXcodeOptions } from "./types.js";
import type { DebugLogger } from "./types.js";
import { createAskUserQuestionTool } from "./acp/ask-user-question-tool.js";
import { createEnterPlanModeTool } from "./acp/enter-plan-mode-tool.js";
import { createExitPlanModeTool } from "./acp/exit-plan-mode-tool.js";
import { createTodoWriteTool } from "./acp/todo-write-tool.js";
import { createWebSearchTool } from "./acp/web-search-tool.js";
import { ensureAbsolutePath } from "./util/paths.js";

export interface ManagedPiSession {
	acpSessionId: string;
	cwd: string;
	session: AgentSession;
	mcpManager?: XcodeMcpManager;
}

export interface PiSessionManagerHooks {
	getActiveAcpSessionId(): string | undefined;
	getConnection(): acp.AgentSideConnection | undefined;
	onEnterPlanMode(sessionId: string): Promise<void> | void;
	onExitPlanApproved(sessionId: string): Promise<void> | void;
	onExitPlanRejected(sessionId: string): Promise<void> | void;
}

export class PiSessionManager {
	private readonly sessions = new Map<string, ManagedPiSession>();

	constructor(
		private readonly options: PiXcodeOptions,
		private readonly logger: DebugLogger,
		private readonly hooks?: PiSessionManagerHooks,
	) {}

	async createSession(
		cwdInput: string,
		mcpServers?: acp.McpServer[],
	): Promise<ManagedPiSession> {
		const cwd = ensureAbsolutePath(cwdInput);
		const sessionManager = SessionManager.create(cwd);
		const mcpManager = await XcodeMcpManager.connect(
			mcpServers,
			cwd,
			this.options,
			this.logger,
		);
		const hasModelOverrides = Boolean(
			this.options.model || this.options.provider || this.options.thinking,
		);
		const settingsManager = SettingsManager.create(cwd);
		if (hasModelOverrides) {
			settingsManager.applyOverrides({
				defaultProvider: this.options.provider,
				defaultModel: this.options.model,
				defaultThinkingLevel: this.options.thinking,
			});
			this.logger.log("Applied Pi model settings overrides", {
				provider: this.options.provider,
				model: this.options.model,
				thinking: this.options.thinking,
			});
		}

		const services = await createAgentSessionServices({ cwd, settingsManager });
		this.logger.log("Pi services created", {
			cwd: services.cwd,
			agentDir: services.agentDir,
			diagnosticCount: services.diagnostics.length,
			availableModelCount: services.modelRegistry.getAvailable().length,
			configuredModelCount: services.modelRegistry.getAll().length,
			configuredProviders: summarizeProviders(services.modelRegistry.getAll()),
			availableProviders: summarizeProviders(
				services.modelRegistry.getAvailable(),
			),
			settings: {
				defaultProvider: settingsManager.getDefaultProvider(),
				defaultModel: settingsManager.getDefaultModel(),
				defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			},
		});
		for (const diagnostic of services.diagnostics) {
			this.logger.log("Pi service diagnostic", diagnostic);
		}

		const createOptions: CreateAgentSessionFromServicesOptions = {
			services,
			sessionManager,
		};

		if (this.options.tools) createOptions.tools = this.options.tools;
		if (this.options.excludeTools)
			createOptions.excludeTools = this.options.excludeTools;
		if (this.options.thinking)
			createOptions.thinkingLevel = this.options.thinking;
		const customTools: Array<ToolDefinition<any, any, any>> = [];
		if (this.hooks) {
			customTools.push(
				createAskUserQuestionTool({
					name: "ask_user_question",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
				}),
				createAskUserQuestionTool({
					name: "AskUserQuestion",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
				}),
				createEnterPlanModeTool({
					name: "EnterPlanMode",
					getSessionId: this.hooks.getActiveAcpSessionId,
					onEnterPlanMode: this.hooks.onEnterPlanMode,
				}),
				createEnterPlanModeTool({
					name: "enter_plan_mode",
					getSessionId: this.hooks.getActiveAcpSessionId,
					onEnterPlanMode: this.hooks.onEnterPlanMode,
				}),
				createExitPlanModeTool({
					name: "ExitPlanMode",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
					onApproved: this.hooks.onExitPlanApproved,
					onRejected: this.hooks.onExitPlanRejected,
				}),
				createExitPlanModeTool({
					name: "exit_plan_mode",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
					onApproved: this.hooks.onExitPlanApproved,
					onRejected: this.hooks.onExitPlanRejected,
				}),
				createTodoWriteTool({
					name: "TodoWrite",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
				}),
				createTodoWriteTool({
					name: "todo_write",
					getSessionId: this.hooks.getActiveAcpSessionId,
					getConnection: this.hooks.getConnection,
				}),
				createWebSearchTool({ name: "WebSearch" }),
				createWebSearchTool({ name: "web_search_alias" }),
			);
		}
		const mcpCustomTools = mcpManager?.getCustomTools();
		if (mcpCustomTools && mcpCustomTools.length > 0) {
			customTools.push(...mcpCustomTools);
			this.logger.log("Adding MCP custom tools to Pi session", {
				toolCount: mcpCustomTools.length,
				tools: mcpCustomTools.map((tool) => tool.name),
			});
		}
		if (customTools.length > 0) createOptions.customTools = customTools;

		const { session, modelFallbackMessage } =
			await createAgentSessionFromServices(createOptions);
		if (modelFallbackMessage)
			this.logger.log("Pi model fallback", { message: modelFallbackMessage });

		const managed: ManagedPiSession = {
			acpSessionId: session.sessionId,
			cwd,
			session,
			mcpManager,
		};
		this.sessions.set(managed.acpSessionId, managed);
		this.logger.log("Created Pi session", {
			acpSessionId: managed.acpSessionId,
			cwd,
			sessionFile: session.sessionFile,
			provider: session.model?.provider,
			model: session.model?.id,
			modelName: session.model?.name,
			thinkingLevel: session.thinkingLevel,
			activeTools: session.getActiveToolNames(),
			toolCount: session.getAllTools().length,
		});
		return managed;
	}

	getSession(acpSessionId: string): ManagedPiSession {
		const managed = this.sessions.get(acpSessionId);
		if (!managed) throw new Error(`Unknown session: ${acpSessionId}`);
		return managed;
	}

	async abortSession(acpSessionId: string): Promise<void> {
		const managed = this.sessions.get(acpSessionId);
		if (!managed) return;
		await managed.session.abort();
	}

	async closeSession(acpSessionId: string): Promise<void> {
		const managed = this.sessions.get(acpSessionId);
		if (!managed) return;
		await managed.session.abort();
		managed.session.dispose();
		await managed.mcpManager?.dispose();
		this.sessions.delete(acpSessionId);
		this.logger.log("Closed Pi session", { acpSessionId });
	}

	async dispose(): Promise<void> {
		await Promise.all(
			[...this.sessions.keys()].map((sessionId) =>
				this.closeSession(sessionId),
			),
		);
	}
}

function summarizeProviders(
	models: Array<{ provider: string }>,
): Array<{ provider: string; modelCount: number }> {
	const counts = new Map<string, number>();
	for (const model of models) {
		counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([provider, modelCount]) => ({ provider, modelCount }));
}
