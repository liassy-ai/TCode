import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const BUILTIN_AGENT_NAMES: readonly string[] = ["Explore"];

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export interface SaveUserAgentInput {
	name: string;

	originalName?: string;

	description: string;

	systemPrompt: string;

	tools: string[];
}

function agentsDir(): string {
	return join(getAgentDir(), "agents");
}

function agentFile(name: string): string {
	return join(agentsDir(), `${name}.md`);
}

function isBuiltinName(name: string): boolean {
	return BUILTIN_AGENT_NAMES.some((builtin) => builtin.toLowerCase() === name.toLowerCase());
}

function assertName(name: string): void {
	if (!NAME_PATTERN.test(name) || name.endsWith(".") || WINDOWS_RESERVED.test(name)) {
		throw new Error(`invalid subagent name: ${name || "(empty)"}`);
	}
	if (isBuiltinName(name)) throw new Error(`"${name}" is a built-in subagent and cannot be overridden`);
}

function cleanTools(tools: string[]): string[] {
	return [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))];
}

function scalar(value: string): string {
	if (value.includes("'")) return JSON.stringify(value);
	if (value === "" || value !== value.trim() || /["#]/.test(value) || value.includes(":")) {
		return "'" + value + "'";
	}
	return value;
}

function serializeAgent(input: {
	name: string;
	description: string;
	tools: string[];
	systemPrompt: string;
}): string {
	const frontmatter = [
		"---",
		`name: ${input.name}`,
		`description: ${scalar(input.description)}`,
		`tools: ${JSON.stringify(input.tools)}`,
		"---",
		"",
	];
	return `${frontmatter.join("\n")}\n${input.systemPrompt.trimEnd()}\n`;
}

export async function saveUserAgent(input: SaveUserAgentInput): Promise<string> {
	const name = input.name.trim();
	assertName(name);
	const systemPrompt = input.systemPrompt.trim();
	if (!systemPrompt) throw new Error("subagent system prompt is required");
	const previous = input.originalName?.trim();
	if (previous) assertName(previous);

	const target = agentFile(name);
	if (previous && previous !== name) {
		if (existsSync(target)) throw new Error(`subagent already exists: ${name}`);
		if (!existsSync(agentFile(previous))) throw new Error(`subagent not found: ${previous}`);
	} else if (!previous && existsSync(target)) {
		throw new Error(`subagent already exists: ${name}`);
	}

	await mkdir(agentsDir(), { recursive: true });
	await writeFile(
		target,
		serializeAgent({
			name,
			description: input.description.trim(),
			tools: cleanTools(input.tools),
			systemPrompt,
		}),
		"utf8",
	);
	if (previous && previous !== name) await rm(agentFile(previous), { force: true });
	return target;
}

export async function deleteUserAgent(name: string): Promise<void> {
	const clean = name.trim();
	if (!clean) throw new Error("subagent name is required");
	if (isBuiltinName(clean)) throw new Error(`"${clean}" is a built-in subagent and cannot be deleted`);
	const dir = agentsDir();
	const target = resolve(agentFile(clean));
	const rel = relative(resolve(dir), target);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("invalid subagent path");
	if (!existsSync(target)) throw new Error(`subagent not found: ${clean}`);
	await rm(target);
}
