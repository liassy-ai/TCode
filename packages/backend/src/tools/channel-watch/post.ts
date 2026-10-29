import { appendFile, mkdir } from "node:fs/promises";
import { topicDir } from "./init";

export const MESSAGES_FILE = "MESSAGES.md";

export interface PostInput {
	topic: string;
	message: string;
	closed?: boolean;

	sessionId?: string;

	at?: Date;
}

function formatTimestamp(at: Date): string {
	const p = (n: number): string => String(n).padStart(2, "0");
	return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
}

export function formatPostEntry(input: PostInput): string {
	const at = input.at ?? new Date();
	const source = input.sessionId ? ` · ${input.sessionId.slice(0, 8)}` : "";
	const closed = input.closed ? " · [CLOSED]" : "";
	const body = input.message.replace(/\s+$/, "");
	return `## ${formatTimestamp(at)}${source}${closed}\n\n${body}\n\n---\n`;
}

export async function appendPost(cwd: string, input: PostInput): Promise<string> {
	const dir = topicDir(cwd, input.topic);
	await mkdir(dir, { recursive: true });
	const file = `${dir}/${MESSAGES_FILE}`;
	await appendFile(file, formatPostEntry(input), "utf8");
	return file;
}
