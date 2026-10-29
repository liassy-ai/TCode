import type { SlashCommandInfo } from "@tcode/shared";
import type { Translate } from "../../i18n";
import { slashPresentation } from "./slash-label";

export const SOURCE_ORDER: SlashCommandInfo["source"][] = ["builtin", "template", "skill", "extension"];

const SKILL_PREFIX = "skill:";

export interface SlashToken {
	start: number;

	end: number;

	query: string;
}

export function extractSlashToken(text: string, cursor: number): SlashToken | null {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf("/");
	if (at === -1) return null;
	if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
	const query = before.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { start: at, end: cursor, query };
}

export function removeSlashToken(text: string, token: SlashToken): string {
	const before = text.slice(0, token.start);
	let after = text.slice(token.end);
	if (after.startsWith(" ") && (before.endsWith(" ") || token.start === 0)) {
		after = after.slice(1);
	}
	return before + after;
}

export function filterCommands(
	commands: SlashCommandInfo[],
	query: string,
	t?: Translate,
): SlashCommandInfo[] {
	if (!query) return commands;
	const rest = commands.filter(
		(c) =>
			c.source !== "skill" &&
			(c.name.startsWith(query) ||
				(c.source === "builtin" && t && slashPresentation(c, t).label.startsWith(query))),
	);
	const prefixSkills: SlashCommandInfo[] = [];
	const substringSkills: SlashCommandInfo[] = [];
	for (const skill of commands) {
		if (skill.source !== "skill") continue;
		const bare = skill.name.startsWith(SKILL_PREFIX) ? skill.name.slice(SKILL_PREFIX.length) : skill.name;
		if (skill.name.startsWith(query) || bare.startsWith(query)) {
			prefixSkills.push(skill);
		} else if (bare.includes(query)) {
			substringSkills.push(skill);
		}
	}
	return [...rest, ...prefixSkills, ...substringSkills];
}
