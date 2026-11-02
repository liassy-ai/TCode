import { chatLanguage, type Translate, translate, useI18nStore } from "../../i18n";
import type { Messages } from "../../i18n/zh";

type BuiltinToolName = keyof Messages["tool"]["names"];
const BUILTIN_TOOL_NAMES = new Set<string>([
	"read",
	"edit",
	"write",
	"bash",
	"ls",
	"glob",
	"grep",
	"find",
	"powershell",
	"webfetch",
	"browser",
	"show_image",
	"todo",
	"subagent",
	"run_code",
	"channel_subscribe",
	"channel_unsubscribe",
	"channel_post",
	"channel_list",
	"ask_user",
] satisfies BuiltinToolName[]);

export function displayName(name: string, t?: Translate): string {
	if (!BUILTIN_TOOL_NAMES.has(name)) return name;
	const key = `tool.names.${name as BuiltinToolName}` as const;

	return t ? t(key) : translate(chatLanguage(useI18nStore.getState().language), key);
}
