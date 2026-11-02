import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createLogger } from "@tcode/backend";

const log = createLogger("fix-path");

export function wellKnownBinDirs(platform: NodeJS.Platform, home: string): string[] {
	if (platform === "darwin") {
		return [
			"/opt/homebrew/bin",
			"/opt/homebrew/sbin",
			"/usr/local/bin",
			"/usr/local/sbin",
			`${home}/.local/bin`,
			`${home}/.volta/bin`,
			`${home}/.asdf/shims`,
			`${home}/Library/pnpm`,
			`${home}/.bun/bin`,
		];
	}
	if (platform === "linux") {
		return [`${home}/.local/bin`, "/usr/local/bin", "/snap/bin", `${home}/.volta/bin`, `${home}/.asdf/shims`];
	}
	return [];
}

export function mergePath(current: string, extra: string[]): string {
	const entries = current.split(":").filter((e) => e.length > 0);
	const seen = new Set(entries);
	for (const dir of extra) {
		if (!dir || seen.has(dir)) continue;
		seen.add(dir);
		entries.push(dir);
	}
	return entries.join(":");
}

export function parseShellEnvPath(output: string): string | null {
	for (const line of output.split("\n")) {
		if (line.startsWith("PATH=")) {
			const value = line.slice("PATH=".length).trim();
			if (value.length > 0) return value;
		}
	}
	return null;
}

function fixPathSync(): void {
	const candidates = wellKnownBinDirs(process.platform, homedir()).filter((dir) => existsSync(dir));
	const merged = mergePath(process.env.PATH ?? "", candidates);
	if (merged !== process.env.PATH) {
		process.env.PATH = merged;
		log.info("PATH 已追加常见 bin 目录", candidates);
	}
}

function fixPathFromLoginShell(): void {
	const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

	execFile(shell, ["-ilc", "command env"], { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
		if (error) {
			log.warn("登录 shell PATH 解析失败（保留同步段结果）", error.message);
			return;
		}
		const shellPath = parseShellEnvPath(stdout);
		if (!shellPath) {
			log.warn("登录 shell 输出中未找到 PATH");
			return;
		}
		const merged = mergePath(process.env.PATH ?? "", shellPath.split(":"));
		if (merged !== process.env.PATH) {
			process.env.PATH = merged;
			log.info("PATH 已合并登录 shell 条目", { shell });
		}
	});
}

if (process.platform !== "win32") {
	fixPathSync();
	fixPathFromLoginShell();
}
