import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { formatSkillCommand, parseExpandedSkillInvocation } from "@tcode/shared";

export type MessageContent = string | ReadonlyArray<{ type?: string; text?: string }>;

export function userMessageText(content: MessageContent): string {
	const text =
		typeof content === "string"
			? content
			: content
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join(" ");
	const invocation = parseExpandedSkillInvocation(text);
	return invocation ? formatSkillCommand(invocation) : text;
}

export function firstLineTitle(text: string): string | undefined {
	const firstLine = (text.trim().split("\n")[0] ?? "").trim();
	if (!firstLine) return undefined;
	return firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
}

export function autoNameSession(session: AgentSession, event: AgentSessionEvent): void {
	if (event.type !== "message_start") return;
	if (session.sessionManager.getSessionName()) return;
	const message = event.message;
	if (message.role !== "user") return;
	const title = firstLineTitle(userMessageText(message.content));
	if (title) session.setSessionName(title);
}
