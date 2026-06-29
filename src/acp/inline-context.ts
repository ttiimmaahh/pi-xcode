import type * as acp from "@agentclientprotocol/sdk";
import { fileUriToPath } from "../util/paths.js";

export function describeResourceLink(link: acp.ResourceLink): string {
	const filePath = fileUriToPath(link.uri);
	const location = filePath ? describeFileLocation(filePath, link) : link.uri;
	const title = link.title ?? link.name;
	const description = link.description ? `\n${link.description}` : "";
	return `Referenced resource: ${title}\n${location}${description}`;
}

function describeFileLocation(
	filePath: string,
	link: acp.ResourceLink,
): string {
	const line = metadataNumber(link._meta, [
		"line",
		"startLine",
		"selectionStartLine",
	]);
	const endLine = metadataNumber(link._meta, ["endLine", "selectionEndLine"]);
	const lineSuffix = line
		? endLine && endLine !== line
			? `:${line}-${endLine}`
			: `:${line}`
		: "";
	return `@${filePath}${lineSuffix}`;
}

function metadataNumber(
	meta: Record<string, unknown> | null | undefined,
	keys: string[],
): number | undefined {
	if (!meta) return undefined;
	for (const key of keys) {
		const value = meta[key];
		if (typeof value === "number") return value;
		if (typeof value === "string") {
			const parsed = Number.parseInt(value, 10);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	for (const value of Object.values(meta)) {
		if (typeof value !== "object" || value === null) continue;
		const nested = metadataNumber(value as Record<string, unknown>, keys);
		if (nested) return nested;
	}
	return undefined;
}
