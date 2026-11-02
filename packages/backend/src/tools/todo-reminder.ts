import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { extractTodos, TODO_REMINDER_CUSTOM_TYPE, TODO_TOOL_NAME, type TodoItem } from "@tcode/shared";
import { formatTodoList } from "./todo";

export function makeTodoReminderExtension(): InlineExtension {
	return {
		name: "todo-reminder",
		factory: (pi) => {
			let currentTodos: TodoItem[] = [];
			let needsReminder = false;

			pi.on("tool_execution_end", (event) => {
				if (event.toolName !== TODO_TOOL_NAME || event.isError) return;
				const todos = extractTodos((event.result as { details?: unknown } | undefined)?.details);
				if (todos) currentTodos = todos;
			});

			pi.on("session_compact", () => {
				needsReminder = true;
			});

			pi.on("context", (event) => {
				if (!needsReminder || currentTodos.length === 0) return;
				needsReminder = false;
				return {
					messages: [
						...event.messages,
						{
							role: "custom",
							customType: TODO_REMINDER_CUSTOM_TYPE,
							content: `The conversation history was compacted. Continue working on this task list:\n${formatTodoList(currentTodos)}`,
							display: false,
							details: { todos: currentTodos },
							timestamp: Date.now(),
						},
					],
				};
			});
		},
	};
}
