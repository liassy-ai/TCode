import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TODO_TOOL_NAME, type TodoItem } from "@tcode/shared";
import { Type } from "typebox";

const MAX_TODOS = 50;

export function normalizeTodos(raw: TodoItem[]): TodoItem[] {
	const out: TodoItem[] = [];
	let inProgressSeen = false;
	for (const item of raw) {
		const content = item.content.trim();
		if (!content) continue;
		if (out.length >= MAX_TODOS) break;
		let status = item.status;
		if (status === "in_progress") {
			if (inProgressSeen) status = "pending";
			else inProgressSeen = true;
		}
		out.push({ content, status });
	}
	return out;
}

export function formatTodoList(todos: TodoItem[]): string {
	return todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n");
}

const todoParams = Type.Object({
	todos: Type.Array(
		Type.Object({
			content: Type.String({ minLength: 1, description: "Task description" }),
			status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
		}),
		{
			maxItems: MAX_TODOS,
			description: "The FULL updated task list (this call replaces the previous list entirely)",
		},
	),
});

export function makeTodoTool(): ToolDefinition<typeof todoParams> {
	return {
		name: TODO_TOOL_NAME,
		label: "Todo",
		description:
			"Task list for complex multi-step work (long refactors, multi-file features, multi-step investigations). Each call replaces the previous list entirely, so always pass the FULL updated list. Keep at most ONE item in_progress, mark items done as soon as they are, and pass an empty list when the task is finished.",
		promptSnippet: "todo({todos})",
		parameters: todoParams,
		execute: async (
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		): Promise<AgentToolResult<{ todos: TodoItem[] }>> => {
			const todos = normalizeTodos(params.todos);
			const content =
				todos.length === 0 ? "Todo list cleared (empty)." : `Current task list:\n${formatTodoList(todos)}`;
			return {
				content: [{ type: "text", text: content }],
				details: { todos },
			};
		},
	};
}
