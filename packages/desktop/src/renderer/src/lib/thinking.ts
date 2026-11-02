import { THINKING_LEVELS } from "@tcode/shared";

export { THINKING_LEVELS, type ThinkingLevel } from "@tcode/shared";

export const THINKING_BAR_KNOB = 26;

export function isThinkingLevel(value: string): value is (typeof THINKING_LEVELS)[number] {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function normalizeThinkingLevel(level: string): string {
	if (level === "off") return "none";
	if (level === "xh") return "xhigh";
	return isThinkingLevel(level) ? level : "medium";
}

export function visibleThinkingLevels(levels?: string[]): readonly string[] {
	if (!levels || levels.length === 0) return THINKING_LEVELS;
	const unlocked = new Set(levels.map((level) => normalizeThinkingLevel(level)));
	const visible = THINKING_LEVELS.filter((level) => unlocked.has(level));
	return visible.length > 0 ? visible : THINKING_LEVELS;
}

export function thinkingLevelKey(level: string): `thinkingLevels.${(typeof THINKING_LEVELS)[number]}` {
	const normalized = normalizeThinkingLevel(level);
	return `thinkingLevels.${isThinkingLevel(normalized) ? normalized : "medium"}`;
}

export function thinkingLevelPos(index: number, count: number): number {
	if (count <= 1) return 0;
	const clamped = Math.min(Math.max(index, 0), count - 1);
	return clamped / (count - 1);
}
