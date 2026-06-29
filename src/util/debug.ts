import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DebugLogger } from "../types.js";

export function defaultDebugLogPath(): string {
	return join(homedir(), ".pi", "agent", "pi-xcode", "debug.log");
}

export function createDebugLogger(
	enabled: boolean,
	logPath = defaultDebugLogPath(),
): DebugLogger {
	const write = (
		level: "debug" | "error",
		message: string,
		details?: unknown,
	) => {
		if (!enabled) return;
		try {
			mkdirSync(dirname(logPath), { recursive: true });
			const payload = details === undefined ? "" : ` ${safeStringify(details)}`;
			appendFileSync(
				logPath,
				`${new Date().toISOString()} ${level.toUpperCase()} ${message}${payload}\n`,
				"utf8",
			);
		} catch {
			// ACP uses stdout for protocol messages. Avoid fallback logging that could corrupt stdio.
		}
	};

	return {
		enabled,
		log: (message, details) => write("debug", message, details),
		error: (message, error) => write("error", message, serializeError(error)),
	};
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

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
