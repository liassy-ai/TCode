import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "../../log";

const log = createLogger("channel-watch-init");

const execFileAsync = promisify(execFile);

export type CheckIgnoreFn = (cwd: string, rel: string) => Promise<"ignored" | "not-ignored" | "not-git">;

let checkIgnoreOverride: CheckIgnoreFn | undefined;

export function setCheckIgnoreOverride(fn: CheckIgnoreFn | undefined): void {
	checkIgnoreOverride = fn;
}

async function checkIgnoreViaSystemGit(
	cwd: string,
	rel: string,
): Promise<"ignored" | "not-ignored" | "not-git"> {
	try {
		const { stdout } = await execFileAsync("git", ["check-ignore", "-q", rel], {
			cwd,
			timeout: 5000,
		});
		void stdout;
		return "ignored";
	} catch (err) {
		const code = (err as { code?: number | string }).code;
		if (code === 1) return "not-ignored";
		return "not-git";
	}
}

export const AGENT_WORK_REL = ".local/agent-work";
export const GITIGNORE_LINE = `${AGENT_WORK_REL}/`;

export function agentWorkRoot(cwd: string): string {
	return join(cwd, AGENT_WORK_REL);
}
export function channelRoot(cwd: string): string {
	return join(agentWorkRoot(cwd), "channel");
}
export function specRoot(cwd: string): string {
	return join(agentWorkRoot(cwd), "spec");
}
export function planRoot(cwd: string): string {
	return join(agentWorkRoot(cwd), "plan");
}
export function topicDir(cwd: string, topic: string): string {
	return join(channelRoot(cwd), topic);
}

export function validateTopic(topic: string): string | null {
	if (typeof topic !== "string" || topic.length === 0) return "topic 不能为空";
	if (topic.length > 128) return "topic 过长（≤128 字符）";
	if (topic === "." || topic === "..") return "topic 不能是 . 或 ..";
	if (topic.startsWith(".")) return "topic 不能以 . 开头（隐藏目录）";
	if (topic.includes("/") || topic.includes("\\")) return "topic 不能包含路径分隔符";
	if (topic.includes("\0")) return "topic 含非法字符";
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(topic)) {
		return "topic 只能包含字母数字 . _ -（且以字母数字开头）";
	}
	return null;
}

export type GitignoreOutcome = "ignored" | "appended" | "not-git" | "skipped";

export interface InitResult {
	created: string[];

	gitignore: GitignoreOutcome;

	alreadyInitialized: boolean;
}

async function checkIgnored(cwd: string): Promise<"ignored" | "not-ignored" | "not-git"> {
	if (checkIgnoreOverride) {
		try {
			return await checkIgnoreOverride(cwd, AGENT_WORK_REL);
		} catch {
			return "not-git";
		}
	}
	return checkIgnoreViaSystemGit(cwd, AGENT_WORK_REL);
}

async function ensureDir(dir: string): Promise<boolean> {
	try {
		await stat(dir);
		return false;
	} catch {
		await mkdir(dir, { recursive: true });
		return true;
	}
}

export async function ensureAgentWorkInit(cwd: string): Promise<InitResult> {
	const dirs = [agentWorkRoot(cwd), channelRoot(cwd), specRoot(cwd), planRoot(cwd)];
	let alreadyInitialized = true;
	const created: string[] = [];
	for (const dir of dirs) {
		const isNew = await ensureDir(dir);
		if (isNew) {
			created.push(dir);
			alreadyInitialized = false;
		}
	}

	let gitignore: GitignoreOutcome = "skipped";
	const ignoreState = await checkIgnored(cwd);
	if (ignoreState === "ignored") {
		gitignore = "ignored";
	} else if (ignoreState === "not-ignored") {
		const gitignorePath = join(cwd, ".gitignore");
		let existing = "";
		try {
			existing = await readFile(gitignorePath, "utf8");
		} catch {
			existing = "";
		}

		const lines = existing.split(/\r?\n/);
		if (lines.some((l) => l.trim() === GITIGNORE_LINE || l.trim() === AGENT_WORK_REL)) {
			gitignore = "ignored";
		} else {
			const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
			await appendFile(gitignorePath, `${prefix}${GITIGNORE_LINE}\n`);
			gitignore = "appended";
		}
	} else {
		gitignore = "not-git";
	}

	log.debug("agent-work init", { created: created.length, gitignore });
	return { created, gitignore, alreadyInitialized };
}
