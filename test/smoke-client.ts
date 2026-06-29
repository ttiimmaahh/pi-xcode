import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";

async function main(): Promise<void> {
	const runPrompt = process.env.PI_XCODE_SMOKE_PROMPT === "1";
	const child = spawn(process.execPath, ["dist/cli.js", "--debug"], {
		cwd: process.cwd(),
		stdio: ["pipe", "pipe", "inherit"],
	});

	const input = Writable.toWeb(child.stdin!);
	const output = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
	const stream = acp.ndJsonStream(input, output);

	try {
		await acp
			.client({ name: "pi-xcode-smoke" })
			.onNotification(acp.CLIENT_METHODS.session_update, (ctx) => {
				const update = ctx.params.update;
				if (
					update.sessionUpdate === "agent_message_chunk" &&
					update.content.type === "text"
				) {
					process.stderr.write(update.content.text);
				}
			})
			.onRequest(acp.CLIENT_METHODS.session_request_permission, () => ({
				outcome: { outcome: "selected", optionId: "allow" },
			}))
			.connectWith(stream, async (agent) => {
				const init = await agent.request(acp.methods.agent.initialize, {
					protocolVersion: acp.PROTOCOL_VERSION,
					clientCapabilities: {},
					clientInfo: { name: "pi-xcode-smoke", version: "0.1.0" },
				});
				assert(
					init.protocolVersion === acp.PROTOCOL_VERSION,
					"Unexpected protocol version",
				);
				assert(init.agentInfo?.name === "pi-xcode", "Unexpected agent name");

				const session = await agent.request(acp.methods.agent.session.new, {
					cwd: process.cwd(),
					mcpServers: [],
				});
				assert(session.sessionId.length > 0, "Missing session ID");

				if (runPrompt) {
					const prompt = agent.request(acp.methods.agent.session.prompt, {
						sessionId: session.sessionId,
						prompt: [
							{ type: "text", text: "Say hello in one short sentence." },
						],
					});
					setTimeout(
						() =>
							void agent.notify(acp.methods.agent.session.cancel, {
								sessionId: session.sessionId,
							}),
						250,
					).unref();
					const result = await prompt;
					assert(
						["end_turn", "cancelled"].includes(result.stopReason),
						`Unexpected stop reason ${result.stopReason}`,
					);
				}

				await agent.request(acp.methods.agent.session.close, {
					sessionId: session.sessionId,
				});
			});
	} finally {
		child.kill("SIGTERM");
		await Promise.race([
			once(child, "exit"),
			new Promise((resolve) => setTimeout(resolve, 1000)),
		]);
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

main()
	.then(() => {
		process.stderr.write("pi-xcode smoke test passed\n");
	})
	.catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.stack : String(error)}\n`,
		);
		process.exit(1);
	});
