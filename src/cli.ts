#!/usr/bin/env node

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createDebugLogger, defaultDebugLogPath } from "./util/debug.js";
import { XcodeAgent } from "./xcode-agent.js";
import type { PiXcodeOptions, ThinkingLevel } from "./types.js";

function parseCliArgs(argv: string[]): PiXcodeOptions {
	const options: PiXcodeOptions = {};

	for (let index = 0; index < argv.length; index += 1) {
		const rawArg = argv[index];
		const { flag, inlineValue } = splitInlineArg(rawArg);
		if (flag === "--debug") {
			if (inlineValue !== undefined)
				throw new Error("--debug does not accept a value");
			options.debug = true;
		} else if (flag === "--debug-log") {
			options.debugLogPath = readValue(argv, ++index, flag, inlineValue);
		} else if (flag === "--provider") {
			options.provider = readValue(argv, ++index, flag, inlineValue);
		} else if (flag === "--model") {
			options.model = readValue(argv, ++index, flag, inlineValue);
			if (!options.provider && !options.model.startsWith("@")) {
				const parsed = splitProviderModel(options.model);
				if (parsed) {
					options.provider = parsed.provider;
					options.model = parsed.model;
				}
			}
		} else if (flag === "--thinking") {
			options.thinking = parseThinking(
				readValue(argv, ++index, flag, inlineValue),
			);
		} else if (flag === "--tools") {
			options.tools = parseList(readValue(argv, ++index, flag, inlineValue));
		} else if (flag === "--exclude-tools") {
			options.excludeTools = parseList(
				readValue(argv, ++index, flag, inlineValue),
			);
		} else if (flag === "--no-xcode-mcp") {
			if (inlineValue !== undefined)
				throw new Error("--no-xcode-mcp does not accept a value");
			options.noXcodeMcp = true;
		} else if (flag === "--xcode-mcp-tools") {
			options.xcodeMcpTools = parseList(
				readValue(argv, ++index, flag, inlineValue),
			);
		} else if (flag === "--exclude-xcode-mcp-tools") {
			options.excludeXcodeMcpTools = parseList(
				readValue(argv, ++index, flag, inlineValue),
			);
		} else if (flag === "--help" || flag === "-h") {
			printHelpAndExit();
		} else {
			throw new Error(`Unknown argument: ${rawArg}`);
		}

		if (inlineValue !== undefined) index -= 1;
	}

	return options;
}

function splitInlineArg(arg: string): { flag: string; inlineValue?: string } {
	const equalsIndex = arg.indexOf("=");
	if (equalsIndex <= 0) return { flag: arg };
	return {
		flag: arg.slice(0, equalsIndex),
		inlineValue: arg.slice(equalsIndex + 1),
	};
}

function readValue(
	argv: string[],
	index: number,
	flag: string,
	inlineValue?: string,
): string {
	if (inlineValue !== undefined) {
		if (inlineValue.length === 0) throw new Error(`Missing value for ${flag}`);
		return inlineValue;
	}
	const value = argv[index];
	if (!value) throw new Error(`Missing value for ${flag}`);
	return value;
}

function splitProviderModel(
	value: string,
): { provider: string; model: string } | undefined {
	const slashIndex = value.indexOf("/");
	if (slashIndex <= 0 || slashIndex === value.length - 1) return undefined;
	return {
		provider: value.slice(0, slashIndex),
		model: value.slice(slashIndex + 1),
	};
}

function parseList(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseThinking(value: string): ThinkingLevel {
	const allowed: ThinkingLevel[] = [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
	];
	if (!allowed.includes(value as ThinkingLevel)) {
		throw new Error(`Invalid thinking level: ${value}`);
	}
	return value as ThinkingLevel;
}

function printHelpAndExit(): never {
	process.stderr.write(
		`pi-xcode\n\nACP adapter for using Pi as an Xcode Intelligence agent.\n\nOptions:\n  --debug                         Enable debug logging\n  --debug-log <path>              Debug log path (default: ${defaultDebugLogPath()})\n  --provider <provider>           Optional Pi provider override\n  --model <model>                 Optional Pi model override\n  --thinking <level>              Optional thinking override: off|minimal|low|medium|high|xhigh\n  --tools <list>                  Optional comma-separated Pi tool allowlist\n  --exclude-tools <list>          Optional comma-separated Pi tool denylist\n  --no-xcode-mcp                  Do not connect Xcode-provided MCP servers\n  --xcode-mcp-tools <list>        Optional comma-separated Xcode MCP tool allowlist\n  --exclude-xcode-mcp-tools <list> Optional comma-separated Xcode MCP tool denylist\n`,
	);
	process.exit(0);
}

async function main(): Promise<void> {
	const rawArgv = process.argv.slice(2);
	const options = parseCliArgs(rawArgv);
	const logger = createDebugLogger(
		Boolean(options.debug),
		options.debugLogPath,
	);
	logger.log("Starting pi-xcode", {
		rawArgv,
		parsedOptions: {
			...options,
			debugLogPath: options.debugLogPath ?? defaultDebugLogPath(),
		},
		nodeVersion: process.version,
		argv0: process.argv[0],
		execPath: process.execPath,
		cwd: process.cwd(),
	});

	let xcodeAgent: XcodeAgent | undefined;
	const input = Writable.toWeb(process.stdout);
	const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
	const stream = acp.ndJsonStream(input, output);

	new acp.AgentSideConnection((connection) => {
		xcodeAgent = new XcodeAgent(options, logger);
		xcodeAgent.attachConnection(connection);
		return xcodeAgent;
	}, stream);

	const shutdown = async () => {
		logger.log("Shutting down pi-xcode");
		await xcodeAgent?.dispose();
	};

	process.once("SIGINT", () => {
		void shutdown().finally(() => process.exit(130));
	});
	process.once("SIGTERM", () => {
		void shutdown().finally(() => process.exit(143));
	});
}

main().catch((error: unknown) => {
	const logger = createDebugLogger(true);
	logger.error("Fatal pi-xcode error", error);
	process.exit(1);
});
