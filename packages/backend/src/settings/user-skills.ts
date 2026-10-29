import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const SEEDED_BUILTIN_SKILLS: readonly string[] = [
	"web-annotate",
	"tcode-desktop",
	"tcode-browser",
	"tcode-reply-language",
	"tcode-subagent-explore",
	"tcode-ai-title-en",
	"tcode-ai-title-zh",
];

export function readSeededSkillBody(name: string): string | null {
	try {
		const raw = readFileSync(join(getAgentDir(), "skills", `${name}.md`), "utf8");
		const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
		return (match ? raw.slice(match[0].length) : raw).trim() || null;
	} catch {
		return null;
	}
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export interface CreateUserSkillInput {
	name: string;

	description: string;

	content?: string;
}

export async function createUserSkill(input: CreateUserSkillInput): Promise<string> {
	const name = input.name.trim();
	if (!NAME_PATTERN.test(name) || name.endsWith(".") || WINDOWS_RESERVED.test(name)) {
		throw new Error(`invalid skill name: ${name || "(empty)"}`);
	}
	const description = input.description.trim();
	if (!description) throw new Error("skill description is required");

	const skillDir = join(getAgentDir(), "skills", name);
	if (existsSync(skillDir)) throw new Error(`skill already exists: ${name}`);

	const body = input.content?.trim()
		? `${input.content.trimEnd()}\n`
		: "TODO: 补充这个 skill 的使用说明 (describe when to use this skill and the steps)\n";
	await mkdir(skillDir, { recursive: true });
	const file = join(skillDir, "SKILL.md");
	await writeFile(
		file,
		`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`,
		"utf8",
	);
	return file;
}

export async function deleteUserSkill(filePath: string): Promise<void> {
	const skillsDir = join(getAgentDir(), "skills");
	const resolved = resolve(filePath);
	const rel = relative(skillsDir, resolved);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error("only user-level skills (under the agent skills dir) can be deleted");
	}
	if (!/\.(md|markdown)$/i.test(resolved)) throw new Error(`not a markdown file: ${filePath}`);
	if (!existsSync(resolved)) throw new Error(`file not found: ${filePath}`);

	const stem = basename(resolved).replace(/\.(md|markdown)$/i, "");
	const parentName = basename(dirname(resolved));
	if (SEEDED_BUILTIN_SKILLS.includes(stem) || SEEDED_BUILTIN_SKILLS.includes(parentName)) {
		throw new Error(`"${stem || parentName}" is a built-in skill and cannot be deleted`);
	}
	await rm(resolved);
	const parent = dirname(resolved);
	if (parent !== skillsDir) {
		const rest = await readdir(parent).catch(() => null);
		if (rest && rest.length === 0) await rmdir(parent).catch(() => {});
	}
}
