export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	content: string;
	status: TodoStatus;
}

export const TODO_TOOL_NAME = "todo";

export const TODO_REMINDER_CUSTOM_TYPE = "todo-reminder";

export function extractTodos(details: unknown): TodoItem[] | null {
	const d = details as { todos?: unknown } | null | undefined;
	if (!d || !Array.isArray(d.todos)) return null;
	const items: TodoItem[] = [];
	for (const raw of d.todos) {
		const item = raw as { content?: unknown; status?: unknown } | null | undefined;
		if (!item || typeof item.content !== "string" || item.content.length === 0) continue;
		if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") {
			continue;
		}
		items.push({ content: item.content, status: item.status });
	}
	return items;
}
