import { isAbsolute, resolve } from "node:path";

export function ensureAbsolutePath(
	path: string,
	fallbackCwd = process.cwd(),
): string {
	return isAbsolute(path) ? path : resolve(fallbackCwd, path);
}

export function fileUriToPath(uri: string): string | undefined {
	if (!uri.startsWith("file://")) return undefined;
	try {
		return decodeURIComponent(new URL(uri).pathname);
	} catch {
		return undefined;
	}
}
