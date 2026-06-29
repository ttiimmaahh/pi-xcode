import * as acp from "@agentclientprotocol/sdk";
import { PiSessionManager } from "./pi-session-manager.js";
import type { ManagedPiSession } from "./pi-session-manager.js";
import { acpPromptToPiPrompt } from "./translators/acp-to-pi.js";
import { piEventToAcpUpdates } from "./translators/pi-to-acp.js";
import { defaultDebugLogPath } from "./util/debug.js";
import type { DebugLogger, PiXcodeOptions } from "./types.js";

type SessionModeId = "default" | "plan";

export class XcodeAgent implements acp.Agent {
	private readonly piSessions: PiSessionManager;
	private connection: acp.AgentSideConnection | undefined;
	private readonly cancelledPrompts = new Set<string>();
	private readonly sessionModes = new Map<string, SessionModeId>();
	private readonly toolsBeforePlanMode = new Map<string, string[]>();
	private activePromptSessionId: string | undefined;

	private readonly debugLogPath: string;

	constructor(
		options: PiXcodeOptions,
		private readonly logger: DebugLogger,
	) {
		this.debugLogPath = options.debugLogPath ?? defaultDebugLogPath();
		this.piSessions = new PiSessionManager(options, logger, {
			getActiveAcpSessionId: () => this.activePromptSessionId,
			getConnection: () => this.connection,
			onEnterPlanMode: (sessionId) => this.activatePlanMode(sessionId),
			onExitPlanApproved: (sessionId) => this.activateDefaultMode(sessionId),
			onExitPlanRejected: (sessionId) => this.activatePlanMode(sessionId),
		});
	}

	attachConnection(connection: acp.AgentSideConnection): void {
		this.connection = connection;
	}

	async initialize(
		params: acp.InitializeRequest,
	): Promise<acp.InitializeResponse> {
		const response: acp.InitializeResponse = {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
				promptCapabilities: {
					image: true,
					embeddedContext: true,
				},
				sessionCapabilities: {
					close: {},
				},
			},
			agentInfo: {
				name: "pi-xcode",
				title: "Pi for Xcode",
				version: "0.1.0",
			},
			authMethods: [],
		};
		this.logger.log("initialize", {
			clientInfo: params.clientInfo,
			clientCapabilities: params.clientCapabilities,
			protocolVersion: params.protocolVersion,
			agentInfo: response.agentInfo,
			agentCapabilities: response.agentCapabilities,
		});
		return response;
	}

	async authenticate(
		_params: acp.AuthenticateRequest,
	): Promise<acp.AuthenticateResponse> {
		this.logger.log("authenticate noop");
		return {};
	}

	async newSession(
		params: acp.NewSessionRequest,
	): Promise<acp.NewSessionResponse> {
		this.logger.log("session/new", {
			cwd: params.cwd,
			mcpServerCount: params.mcpServers?.length ?? 0,
			mcpServers: summarizeMcpServers(params.mcpServers ?? []),
			additionalDirectories: params.additionalDirectories,
		});

		if (params.mcpServers && params.mcpServers.length > 0) {
			this.logger.log("Ignoring Xcode-provided MCP servers for v1", {
				mcpServers: summarizeMcpServers(params.mcpServers),
			});
		}

		const managed = await this.piSessions.createSession(
			params.cwd,
			params.mcpServers,
		);
		this.sessionModes.set(managed.acpSessionId, "default");
		return {
			sessionId: managed.acpSessionId,
			modes: createSessionModeState("default"),
			configOptions: createSessionConfigOptions("default"),
		};
	}

	async setSessionMode(
		params: acp.SetSessionModeRequest,
	): Promise<acp.SetSessionModeResponse> {
		const modeId = normalizeSessionMode(params.modeId);
		if (modeId === "plan") {
			this.activatePlanMode(params.sessionId);
		} else {
			this.activateDefaultMode(params.sessionId);
		}
		this.logger.log("session/set_mode", {
			sessionId: params.sessionId,
			modeId,
		});
		await this.sendCurrentModeUpdate(params.sessionId, modeId);
		return {};
	}

	async setSessionConfigOption(
		params: acp.SetSessionConfigOptionRequest,
	): Promise<acp.SetSessionConfigOptionResponse> {
		if (params.configId === "mode" && typeof params.value === "string") {
			await this.setSessionMode({
				sessionId: params.sessionId,
				modeId: params.value,
			});
		}
		return {
			configOptions: createSessionConfigOptions(
				this.sessionModes.get(params.sessionId) ?? "default",
			),
		};
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const connection = this.requireConnection();
		const managed = this.piSessions.getSession(params.sessionId);
		const prompt = acpPromptToPiPrompt(params.prompt);
		const planRequest = detectPlanRequest(prompt.text);
		let mode = this.sessionModes.get(params.sessionId) ?? "default";
		if (planRequest.isPlanRequest) {
			mode = "plan";
			this.activatePlanMode(params.sessionId);
			await this.sendCurrentModeUpdate(params.sessionId, mode);
		} else if (mode === "plan") {
			this.enterPlanMode(managed);
		}
		this.cancelledPrompts.delete(params.sessionId);

		const sendUpdate = (notification: acp.SessionNotification) => {
			this.logger.log(
				"ACP session/update",
				summarizeSessionNotification(notification),
			);
			return connection.sessionUpdate(notification).catch((error) => {
				this.logger.error("Failed to send ACP session/update", error);
			});
		};

		const unsubscribe = managed.session.subscribe((event) => {
			for (const notification of piEventToAcpUpdates(
				params.sessionId,
				event,
				managed.cwd,
			)) {
				void sendUpdate(notification);
			}
		});

		try {
			this.activePromptSessionId = params.sessionId;
			const promptText =
				mode === "plan" ? createPlanModePrompt(planRequest.text) : prompt.text;
			this.logger.log("session/prompt", {
				sessionId: params.sessionId,
				mode,
				isPlanRequest: planRequest.isPlanRequest,
				textLength: promptText.length,
				imageCount: prompt.images.length,
			});
			await managed.session.prompt(promptText, {
				images: prompt.images,
				source: "rpc",
			});
			const lastMessage = managed.session.state.messages.at(-1);
			const piStopReason =
				lastMessage?.role === "assistant" ? lastMessage.stopReason : undefined;
			if (lastMessage?.role === "assistant" && piStopReason === "error") {
				await sendUpdate(
					createVisiblePiErrorUpdate(
						params.sessionId,
						formatVisiblePiError(
							managed,
							lastMessage.errorMessage,
							this.debugLogPath,
						),
					),
				);
			} else if (mode === "plan" && lastMessage?.role === "assistant") {
				await this.offerPlanForImplementation(
					params.sessionId,
					managed,
					assistantMessageText(lastMessage),
					sendUpdate,
				);
			}
			const stopReason = this.cancelledPrompts.has(params.sessionId)
				? "cancelled"
				: mapPiStopReason(piStopReason);
			this.logger.log("session/prompt completed", {
				sessionId: params.sessionId,
				acpStopReason: stopReason,
				piStopReason,
				lastRole: lastMessage?.role,
				lastError:
					lastMessage?.role === "assistant"
						? lastMessage.errorMessage
						: undefined,
			});
			return { stopReason };
		} catch (error) {
			if (this.cancelledPrompts.has(params.sessionId)) {
				this.logger.log("session/prompt cancelled", {
					sessionId: params.sessionId,
				});
				return { stopReason: "cancelled" };
			}
			this.logger.error("Pi prompt failed", error);
			await sendUpdate(
				createVisiblePiErrorUpdate(
					params.sessionId,
					formatVisiblePiError(managed, errorMessage(error), this.debugLogPath),
				),
			);
			return { stopReason: "end_turn" };
		} finally {
			unsubscribe();
			if (this.activePromptSessionId === params.sessionId) {
				this.activePromptSessionId = undefined;
			}
			this.cancelledPrompts.delete(params.sessionId);
		}
	}

	async cancel(params: acp.CancelNotification): Promise<void> {
		this.logger.log("session/cancel", { sessionId: params.sessionId });
		this.cancelledPrompts.add(params.sessionId);
		await this.piSessions.abortSession(params.sessionId);
	}

	async closeSession(
		params: acp.CloseSessionRequest,
	): Promise<acp.CloseSessionResponse> {
		this.logger.log("session/close", { sessionId: params.sessionId });
		this.cancelledPrompts.add(params.sessionId);
		this.sessionModes.delete(params.sessionId);
		this.toolsBeforePlanMode.delete(params.sessionId);
		await this.piSessions.closeSession(params.sessionId);
		return {};
	}

	async dispose(): Promise<void> {
		await this.piSessions.dispose();
	}

	private async sendCurrentModeUpdate(
		sessionId: string,
		modeId: SessionModeId,
	): Promise<void> {
		if (!this.connection) return;
		await this.connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "current_mode_update",
				currentModeId: modeId,
			},
		});
	}

	private activatePlanMode(sessionId: string): void {
		const managed = this.piSessions.getSession(sessionId);
		this.sessionModes.set(sessionId, "plan");
		this.enterPlanMode(managed);
	}

	private activateDefaultMode(sessionId: string): void {
		const managed = this.piSessions.getSession(sessionId);
		this.sessionModes.set(sessionId, "default");
		this.exitPlanMode(managed);
		void this.sendCurrentModeUpdate(sessionId, "default");
	}

	private enterPlanMode(managed: ManagedPiSession): void {
		if (!this.toolsBeforePlanMode.has(managed.acpSessionId)) {
			this.toolsBeforePlanMode.set(
				managed.acpSessionId,
				managed.session.getActiveToolNames(),
			);
		}
		managed.session.setActiveToolsByName(
			getPlanModeToolNames(managed.session.getActiveToolNames()),
		);
	}

	private exitPlanMode(managed: ManagedPiSession): void {
		const previousTools = this.toolsBeforePlanMode.get(managed.acpSessionId);
		if (previousTools) {
			managed.session.setActiveToolsByName(previousTools);
			this.toolsBeforePlanMode.delete(managed.acpSessionId);
		}
	}

	private async offerPlanForImplementation(
		sessionId: string,
		managed: ManagedPiSession,
		planText: string,
		sendUpdate: (notification: acp.SessionNotification) => Promise<void>,
	): Promise<void> {
		const plan = extractPlan(planText);
		if (!plan) return;

		await sendUpdate({
			sessionId,
			update: {
				sessionUpdate: "plan",
				entries: plan.entries,
			},
		});

		const connection = this.requireConnection();
		const toolCallId = `pi-exit-plan-${Date.now()}`;
		this.logger.log("ACP session/request_permission", {
			sessionId,
			toolCallId,
			kind: "switch_mode",
			entryCount: plan.entries.length,
		});
		const response = await connection.requestPermission({
			sessionId,
			toolCall: {
				toolCallId,
				title: "Ready to implement?",
				kind: "switch_mode",
				status: "pending",
				content: [
					{
						type: "content",
						content: { type: "text", text: plan.markdown },
					},
				],
				rawInput: { plan: plan.markdown },
			},
			options: [
				{
					optionId: "default",
					name: "Yes, implement this plan",
					kind: "allow_once",
				},
				{
					optionId: "plan",
					name: "No, keep planning",
					kind: "reject_once",
				},
			],
		});

		const selectedMode =
			response.outcome.outcome === "selected"
				? response.outcome.optionId
				: undefined;
		if (selectedMode !== "default") return;

		this.sessionModes.set(sessionId, "default");
		this.exitPlanMode(managed);
		await sendUpdate({
			sessionId,
			update: {
				sessionUpdate: "current_mode_update",
				currentModeId: "default",
			},
		});
		await managed.session.prompt(createImplementationPrompt(plan.markdown), {
			source: "rpc",
		});
	}

	private requireConnection(): acp.AgentSideConnection {
		if (!this.connection)
			throw new Error("ACP connection has not been attached");
		return this.connection;
	}
}

function createSessionConfigOptions(
	currentModeId: SessionModeId,
): acp.SessionConfigOption[] {
	return [
		{
			id: "mode",
			name: "Mode",
			description: "Choose whether Pi should plan first or implement normally.",
			category: "mode",
			type: "select",
			currentValue: currentModeId,
			options: [
				{
					value: "default",
					name: "Code",
					description: "Implement changes with Pi's normal tool access.",
				},
				{
					value: "plan",
					name: "Plan",
					description:
						"Explore and create an implementation plan before editing.",
				},
			],
		},
	];
}

function createSessionModeState(
	currentModeId: SessionModeId,
): acp.SessionModeState {
	return {
		currentModeId,
		availableModes: [
			{
				id: "default",
				name: "Code",
				description: "Implement changes with Pi's normal tool access.",
			},
			{
				id: "plan",
				name: "Plan",
				description:
					"Explore and create an implementation plan before editing.",
			},
		],
	};
}

function normalizeSessionMode(modeId: acp.SessionModeId): SessionModeId {
	return modeId === "plan" ? "plan" : "default";
}

function detectPlanRequest(text: string): {
	isPlanRequest: boolean;
	text: string;
} {
	const trimmed = text.trimStart();
	const slashPlanMatch = trimmed.match(/^\/plan(?:\s+|$)/i);
	if (slashPlanMatch) {
		return {
			isPlanRequest: true,
			text: trimmed.slice(slashPlanMatch[0].length).trimStart() || text,
		};
	}
	return { isPlanRequest: false, text };
}

function createPlanModePrompt(text: string): string {
	return `[PLAN MODE ACTIVE]
You are planning only. Do not make code changes or run commands that modify files, git state, dependencies, simulators, devices, or external systems.

Use read-only inspection tools to gather context. If you need to enter planning from normal mode, call EnterPlanMode first. When ready, call the ExitPlanMode tool with the complete Markdown implementation plan in its plan argument. Include a numbered list of concrete implementation steps. Do not print the final plan as ordinary text unless ExitPlanMode is unavailable. Do not start implementing until the user approves the plan.

User request:
${text}`;
}

function createImplementationPrompt(planMarkdown: string): string {
	return `The user approved this implementation plan. Exit plan mode and implement it now. Follow the steps in order, validate your work, and summarize what changed.

${planMarkdown}`;
}

function getPlanModeToolNames(activeToolNames: string[]): string[] {
	const allowedExact = new Set([
		"read",
		"grep",
		"find",
		"ls",
		"module_report",
		"read_symbol",
		"read_enclosing",
		"lsp_navigation",
		"lsp_diagnostics",
		"lens_diagnostics",
		"ast_grep_search",
		"ast_grep_outline",
		"ast_grep_dump",
		"ast_dump",
		"memory_search",
		"session_search",
		"web_search",
		"fetch_content",
		"get_search_content",
		"ask_user_question",
		"AskUserQuestion",
		"EnterPlanMode",
		"enter_plan_mode",
		"ExitPlanMode",
		"exit_plan_mode",
		"TodoWrite",
		"todo_write",
		"WebSearch",
		"web_search_alias",
	]);
	return activeToolNames.filter((toolName) => {
		if (allowedExact.has(toolName)) return true;
		const normalized = toolName.toLowerCase();
		if (
			/(write|edit|delete|remove|create|update|patch|apply|run|build|test|execute|terminal|bash|shell|git|install|deploy)/u.test(
				normalized,
			)
		) {
			return false;
		}
		return /(read|search|find|list|lookup|diagnostic|outline|symbol|hover|definition|reference|document|context)/u.test(
			normalized,
		);
	});
}

function assistantMessageText(message: unknown): string {
	const record = asRecord(message);
	const content = record.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((item) => {
			const contentItem = asRecord(item);
			return contentItem.type === "text" && typeof contentItem.text === "string"
				? [contentItem.text]
				: [];
		})
		.join("\n");
}

interface ExtractedPlan {
	markdown: string;
	entries: acp.PlanEntry[];
}

function extractPlan(text: string): ExtractedPlan | undefined {
	const markdown = extractPlanMarkdown(text);
	const entries = extractPlanEntries(markdown);
	if (entries.length === 0) return undefined;
	return { markdown, entries };
}

function extractPlanMarkdown(text: string): string {
	const headingMatch = text.match(
		/(^|\n)(#{1,3}\s+)?(?:implementation\s+plan|plan)\s*:?\s*\n/i,
	);
	if (!headingMatch || headingMatch.index === undefined) return text.trim();
	return text.slice(headingMatch.index).trim();
}

function extractPlanEntries(markdown: string): acp.PlanEntry[] {
	const entries: acp.PlanEntry[] = [];
	for (const rawLine of markdown.split(/\r?\n/u)) {
		const line = rawLine.trim();
		const match = line.match(
			/^(?:[-*]\s+|\d+[.)]\s+)(?:\[[ xX-]\]\s*)?(.+?)\s*$/u,
		);
		if (!match?.[1]) continue;
		const content = cleanupPlanEntry(match[1]);
		if (!content || /^```/u.test(content)) continue;
		entries.push({
			content,
			priority: entries.length < 2 ? "high" : "medium",
			status: "pending",
		});
	}
	return entries.slice(0, 12);
}

function cleanupPlanEntry(value: string): string {
	return value
		.replace(/^\*\*(.+?)\*\*:?\s*/u, "$1: ")
		.replace(/\s+/gu, " ")
		.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function summarizeMcpServers(
	mcpServers: acp.McpServer[],
): Array<Record<string, unknown>> {
	return mcpServers.map((server) => {
		const base = {
			name: server.name,
			type: "type" in server ? server.type : "stdio",
		};
		if ("command" in server) {
			return {
				...base,
				command: server.command,
				args: server.args,
				envNames: server.env.map((item) => item.name),
				xcodeEnv: Object.fromEntries(
					server.env
						.filter((item) => item.name.startsWith("MCP_XCODE_"))
						.map((item) => [item.name, item.value]),
				),
			};
		}
		if ("url" in server) return { ...base, url: server.url };
		if ("id" in server) return { ...base, id: server.id };
		return base;
	});
}

function summarizeSessionNotification(
	notification: acp.SessionNotification,
): Record<string, unknown> {
	const update = notification.update;
	const summary: Record<string, unknown> = {
		sessionId: notification.sessionId,
		sessionUpdate: update.sessionUpdate,
	};

	if ("messageId" in update) summary.messageId = update.messageId;
	if ("toolCallId" in update) summary.toolCallId = update.toolCallId;
	if ("title" in update) summary.title = update.title;
	if ("kind" in update) summary.kind = update.kind;
	if ("status" in update) summary.status = update.status;
	if ("content" in update)
		summary.content = summarizeUpdateContent(update.content);
	if ("locations" in update) summary.locations = update.locations;
	return summary;
}

function summarizeUpdateContent(content: unknown): unknown {
	if (Array.isArray(content)) {
		return content.map((item) => summarizeUpdateContent(item));
	}
	if (typeof content !== "object" || content === null) return content;
	const record = content as Record<string, unknown>;
	if (record.type === "text" && typeof record.text === "string") {
		return { ...record, text: truncate(record.text, 240) };
	}
	if (record.type === "content" && "content" in record) {
		return { ...record, content: summarizeUpdateContent(record.content) };
	}
	return record;
}

function createVisiblePiErrorUpdate(
	sessionId: string,
	text: string,
): acp.SessionNotification {
	return {
		sessionId,
		update: {
			sessionUpdate: "agent_message_chunk",
			messageId: `pi-error-${Date.now()}`,
			content: { type: "text", text },
		},
	};
}

function formatVisiblePiError(
	managed: ManagedPiSession,
	message: string | undefined,
	debugLogPath: string,
): string {
	const provider = managed.session.model?.provider ?? "unknown-provider";
	const model = managed.session.model?.id ?? "unknown-model";
	return `Pi request failed using ${provider}/${model}:\n${message ?? "model request failed"}\n\nSee ${debugLogPath} for details.`;
}

function mapPiStopReason(
	stopReason: string | undefined,
): acp.PromptResponse["stopReason"] {
	switch (stopReason) {
		case "length":
			return "max_tokens";
		case "aborted":
			return "cancelled";
		case "stop":
		case "toolUse":
		case "error":
		case undefined:
			return "end_turn";
		default:
			return "end_turn";
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
