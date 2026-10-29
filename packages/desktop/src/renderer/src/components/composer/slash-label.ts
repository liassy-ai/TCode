import type { SlashCommandInfo } from "@tcode/shared";
import type { Translate } from "../../i18n";
import type { Messages } from "../../i18n/zh";

type BuiltinCommandName = keyof Messages["slash"]["builtin"];
const BUILTIN_NAMES = new Set<string>([
	"compact",
	"name",
	"export",
	"settings",
] satisfies BuiltinCommandName[]);

export function slashPresentation(command: SlashCommandInfo, t: Translate) {
	if (command.source !== "builtin" || !BUILTIN_NAMES.has(command.name)) {
		return { label: command.name, description: command.description, argumentHint: command.argumentHint };
	}
	const name = command.name as BuiltinCommandName;
	return {
		label: t(`slash.builtin.${name}.label`),
		description: t(`slash.builtin.${name}.description`),
		argumentHint: name === "settings" ? undefined : t(`slash.builtin.${name}.argumentHint`),
	};
}
