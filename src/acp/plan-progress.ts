import type * as acp from "@agentclientprotocol/sdk";

export function planEntriesFromToolInput(
	toolName: string,
	input: unknown,
): acp.PlanEntry[] | undefined {
	if (!isPlanToolName(toolName)) return undefined;
	const record = asRecord(input);
	const todos = Array.isArray(record.todos)
		? record.todos
		: Array.isArray(record.tasks)
			? record.tasks
			: undefined;
	if (!todos) return undefined;
	const entries = todos.flatMap((todo): acp.PlanEntry[] => {
		const todoRecord = asRecord(todo);
		const content = extractContent(todoRecord);
		if (!content) return [];
		return [
			{
				content,
				priority: normalizePriority(todoRecord.priority),
				status: normalizeStatus(todoRecord.status),
			},
		];
	});
	return entries.length ? entries : undefined;
}

function isPlanToolName(toolName: string): boolean {
	return /^(todo(write)?|task(create|update)?|plan(update)?)$/iu.test(toolName);
}

function extractContent(record: Record<string, unknown>): string | undefined {
	for (const key of ["content", "text", "task", "title", "description"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function normalizePriority(value: unknown): acp.PlanEntryPriority {
	return value === "high" || value === "low" ? value : "medium";
}

function normalizeStatus(value: unknown): acp.PlanEntryStatus {
	if (value === "completed" || value === "in_progress") return value;
	if (value === "done" || value === "complete") return "completed";
	if (value === "active" || value === "running") return "in_progress";
	return "pending";
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}
