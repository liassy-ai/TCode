import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export function makeMainAgentPersonaExtension(
	getPrompt: () => Promise<string | undefined>,
	getName?: () => Promise<string | undefined>,
): InlineExtension {
	return {
		name: "main-agent-persona",
		factory: (pi) => {
			pi.on("before_agent_start", async (event) => {
				const persona = (await getPrompt())?.trim();
				const name = (await getName?.())?.trim();
				const parts: string[] = [];
				if (name) parts.push(`你的名字是「${name}」。`);
				if (persona) parts.push(persona);
				if (parts.length === 0) return;
				return { systemPrompt: `${event.systemPrompt}\n\n${parts.join("\n\n")}` };
			});
		},
	};
}
