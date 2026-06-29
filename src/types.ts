export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface PiXcodeOptions {
	debug?: boolean;
	debugLogPath?: string;
	provider?: string;
	model?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	excludeTools?: string[];
	noXcodeMcp?: boolean;
	xcodeMcpTools?: string[];
	excludeXcodeMcpTools?: string[];
}

export interface DebugLogger {
	enabled: boolean;
	log(message: string, details?: unknown): void;
	error(message: string, error?: unknown): void;
}
