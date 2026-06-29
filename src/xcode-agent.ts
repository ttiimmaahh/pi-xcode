import * as acp from "@agentclientprotocol/sdk";
import { PiSessionManager } from "./pi-session-manager.js";
import type { ManagedPiSession } from "./pi-session-manager.js";
import { acpPromptToPiPrompt } from "./translators/acp-to-pi.js";
import { piEventToAcpUpdates } from "./translators/pi-to-acp.js";
import { defaultDebugLogPath } from "./util/debug.js";
import type { DebugLogger, PiXcodeOptions } from "./types.js";

export class XcodeAgent implements acp.Agent {
	private readonly piSessions: PiSessionManager;
	private connection: acp.AgentSideConnection | undefined;
	private readonly cancelledPrompts = new Set<string>();

	private readonly debugLogPath: string;

	constructor(
		options: PiXcodeOptions,
		private readonly logger: DebugLogger,
	) {
		this.debugLogPath = options.debugLogPath ?? defaultDebugLogPath();
		this.piSessions = new PiSessionManager(options, logger);
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
		return { sessionId: managed.acpSessionId };
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const connection = this.requireConnection();
		const managed = this.piSessions.getSession(params.sessionId);
		const prompt = acpPromptToPiPrompt(params.prompt);
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
			this.logger.log("session/prompt", {
				sessionId: params.sessionId,
				textLength: prompt.text.length,
				imageCount: prompt.images.length,
			});
			await managed.session.prompt(prompt.text, {
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
		await this.piSessions.closeSession(params.sessionId);
		return {};
	}

	async dispose(): Promise<void> {
		await this.piSessions.dispose();
	}

	private requireConnection(): acp.AgentSideConnection {
		if (!this.connection)
			throw new Error("ACP connection has not been attached");
		return this.connection;
	}
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
