import type { AgentSession, Extension, ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { SlashCommandInfo } from "@tcode/shared";

export const BUILTIN_SLASH_COMMANDS: SlashCommandInfo[] = [
	{
		name: "compact",
		description: "Compress session context",
		argumentHint: "[focus]",
		source: "builtin",
		supported: true,
	},
	{
		name: "name",
		description: "Set session display name",
		argumentHint: "<name>",
		source: "builtin",
		supported: true,
	},
	{
		name: "export",
		description: "Export session (.html/.jsonl)",
		argumentHint: "[path]",
		source: "builtin",
		supported: true,
	},
	{
		name: "settings",
		description: "Open settings",
		source: "builtin",
		supported: true,
	},
];

function templateCommands(loader: ResourceLoader): SlashCommandInfo[] {
	return loader.getPrompts().prompts.map((template) => ({
		name: template.name,
		description: template.description,
		argumentHint: template.argumentHint,
		source: "template",
		supported: true,
	}));
}

function skillCommands(loader: ResourceLoader): SlashCommandInfo[] {
	return loader.getSkills().skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill",
		supported: true,
	}));
}

function extensionCommands(extensions: Extension[]): SlashCommandInfo[] {
	const all = extensions.flatMap((ext) => [...ext.commands.values()]);
	const counts = new Map<string, number>();
	for (const command of all) counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
	const seen = new Map<string, number>();
	const taken = new Set<string>();
	return all.map((command) => {
		const occurrence = (seen.get(command.name) ?? 0) + 1;
		seen.set(command.name, occurrence);
		let invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;
		if (taken.has(invocationName)) {
			let suffix = occurrence;
			do {
				suffix++;
				invocationName = `${command.name}:${suffix}`;
			} while (taken.has(invocationName));
		}
		taken.add(invocationName);
		return {
			name: invocationName,
			description: command.description ?? "",
			source: "extension",
			supported: true,
		};
	});
}

export function slashCommandsForSession(session: AgentSession): SlashCommandInfo[] {
	const extensions: SlashCommandInfo[] = session.extensionRunner.getRegisteredCommands().map((command) => ({
		name: command.invocationName,
		description: command.description ?? "",
		source: "extension",
		supported: true,
	}));
	return [
		...BUILTIN_SLASH_COMMANDS,
		...templateCommands(session.resourceLoader),
		...skillCommands(session.resourceLoader),
		...extensions,
	];
}

export function slashCommandsForLoader(loader: ResourceLoader): SlashCommandInfo[] {
	return [
		...BUILTIN_SLASH_COMMANDS,
		...templateCommands(loader),
		...skillCommands(loader),
		...extensionCommands(loader.getExtensions().extensions),
	];
}
