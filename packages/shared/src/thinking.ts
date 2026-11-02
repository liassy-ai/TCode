export const THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const CUSTOM_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type CustomThinkingLevel = (typeof CUSTOM_THINKING_LEVELS)[number];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}
