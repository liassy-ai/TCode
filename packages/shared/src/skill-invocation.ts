export interface SkillInvocation {
	name: string;

	location: string;
	args?: string;
}

export type SkillInvocationDisplay = Pick<SkillInvocation, "name" | "args">;

export function parseExpandedSkillInvocation(text: string): SkillInvocation | null {
	const match = text.match(
		/^<skill name="([^"]+)" location="([^"]+)">\nReferences are relative to [^\n]+\.\n\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/,
	);
	if (!match) return null;
	const [, name, location, rawArgs] = match;
	if (!name || !location) return null;
	return {
		name,
		location,
		args: rawArgs?.trim() || undefined,
	};
}

export function formatSkillCommand({ name, args }: SkillInvocationDisplay): string {
	return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}
