import type * as acp from "@agentclientprotocol/sdk";
import { fileUriToPath } from "../util/paths.js";

export interface PiImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface PiPromptInput {
	text: string;
	images: PiImageContent[];
}

export function acpPromptToPiPrompt(blocks: acp.ContentBlock[]): PiPromptInput {
	const textParts: string[] = [];
	const images: PiImageContent[] = [];

	for (const block of blocks) {
		switch (block.type) {
			case "text":
				textParts.push(block.text);
				break;
			case "image":
				images.push({
					type: "image",
					data: block.data,
					mimeType: block.mimeType,
				});
				if (block.uri) textParts.push(`[Image: ${block.uri}]`);
				break;
			case "resource":
				appendEmbeddedResource(textParts, block.resource);
				break;
			case "resource_link":
				appendResourceLink(textParts, block);
				break;
			case "audio":
				textParts.push(`[Audio attachment omitted: ${block.mimeType}]`);
				break;
			default:
				textParts.push(
					`[Unsupported ACP content block omitted: ${(block as { type?: string }).type ?? "unknown"}]`,
				);
				break;
		}
	}

	return {
		text: textParts.filter((part) => part.length > 0).join("\n\n"),
		images,
	};
}

function appendEmbeddedResource(
	textParts: string[],
	resource: acp.EmbeddedResourceResource,
): void {
	if ("text" in resource) {
		textParts.push(`Referenced resource: ${resource.uri}\n\n${resource.text}`);
		return;
	}

	textParts.push(
		`Referenced binary resource omitted: ${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ""}`,
	);
}

function appendResourceLink(textParts: string[], link: acp.ResourceLink): void {
	const filePath = fileUriToPath(link.uri);
	if (filePath) {
		textParts.push(`Referenced file: @${filePath}`);
		return;
	}

	const title = link.title ?? link.name;
	const description = link.description ? `\n${link.description}` : "";
	textParts.push(
		`Referenced resource link: ${title}\n${link.uri}${description}`,
	);
}
