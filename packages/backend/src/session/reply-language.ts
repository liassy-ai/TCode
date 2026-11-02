import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { readSeededSkillBody } from "../settings/user-skills";
import type { TitleLanguage } from "./ai-title";

export function makeReplyLanguageExtension(getChatLanguage: () => TitleLanguage): InlineExtension {
	return {
		name: "reply-language",
		factory: (pi) => {
			pi.on("before_agent_start", (event) => {
				if (getChatLanguage() !== "zh") return;
				const rule =
					readSeededSkillBody("tcode-reply-language") ??
					"回复语言：当前语言为中文时一律用中文回复；代码、命令、路径、报错原文保持不变。";
				return {
					systemPrompt: `${event.systemPrompt}\n\n${rule}`,
				};
			});
		},
	};
}
