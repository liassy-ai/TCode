import {
	CUSTOM_THINKING_LEVELS,
	type CustomProviderModelInput,
	type CustomThinkingLevel,
	type ThinkingLevelMapInput,
} from "@tcode/shared";

export type LevelFields = Record<CustomThinkingLevel, string>;

export function defaultLevelValue(level: CustomThinkingLevel): string {
	return level === "xhigh" || level === "max" ? "" : level;
}

export function emptyLevelFields(): LevelFields {
	const fields: Partial<LevelFields> = {};
	for (const level of CUSTOM_THINKING_LEVELS) fields[level] = "";
	return fields as LevelFields;
}

export function defaultLevelFields(): LevelFields {
	const fields: Partial<LevelFields> = {};
	for (const level of CUSTOM_THINKING_LEVELS) fields[level] = defaultLevelValue(level);
	return fields as LevelFields;
}

export interface ModelRow {
	id: string;
	contextWindow: string;
	maxTokens: string;
	reasoning: boolean;
	imageInput: boolean;

	levels: LevelFields;
}

export const EMPTY_MODEL_ROW: ModelRow = {
	id: "",
	contextWindow: "",
	maxTokens: "",
	reasoning: false,
	imageInput: false,
	levels: emptyLevelFields(),
};

export function newModelRow(patch: Partial<ModelRow> = {}): ModelRow {
	return { ...EMPTY_MODEL_ROW, levels: defaultLevelFields(), ...patch };
}

export function parseTokenCount(raw: string): number | null {
	const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*k?$/i);
	const numPart = match?.[1];
	if (numPart === undefined) return null;
	const value = Number.parseFloat(numPart) * (/k/i.test(raw.trim()) ? 1000 : 1);
	if (!Number.isInteger(value) || value <= 0) return null;
	return value;
}

export function formatTokenCount(value: number): string {
	return value >= 1000 && value % 1000 === 0 ? `${value / 1000}k` : String(value);
}

export function modelsToRows(
	models: readonly {
		id: string;
		name?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
		imageInput?: boolean;
		thinkingLevelMap?: ThinkingLevelMapInput;
	}[],
): ModelRow[] {
	const rows = models.map((m) => {
		const levels = emptyLevelFields();
		const map = m.thinkingLevelMap;
		for (const level of CUSTOM_THINKING_LEVELS) {
			levels[level] = map && Object.hasOwn(map, level) ? (map[level] ?? "") : defaultLevelValue(level);
		}
		return {
			id: m.id,
			contextWindow: m.contextWindow !== undefined ? formatTokenCount(m.contextWindow) : "",
			maxTokens: m.maxTokens !== undefined ? formatTokenCount(m.maxTokens) : "",
			reasoning: m.reasoning === true,
			imageInput: m.imageInput === true,
			levels,
		};
	});
	return rows.length > 0 ? rows : [{ ...EMPTY_MODEL_ROW, levels: emptyLevelFields() }];
}

export function rowsToModelInputs(rows: ModelRow[]): CustomProviderModelInput[] {
	return rows
		.filter((row) => row.id.trim())
		.map((row) => {
			const thinkingLevelMap: ThinkingLevelMapInput = {};
			if (row.reasoning) {
				for (const level of CUSTOM_THINKING_LEVELS) {
					const value = row.levels[level]?.trim();
					thinkingLevelMap[level] = value ? value : null;
				}
			}
			return {
				id: row.id.trim(),
				reasoning: row.reasoning || undefined,
				contextWindow: (row.contextWindow.trim() && parseTokenCount(row.contextWindow)) || undefined,
				maxTokens: (row.maxTokens.trim() && parseTokenCount(row.maxTokens)) || undefined,
				imageInput: row.imageInput || undefined,
				thinkingLevelMap: row.reasoning ? thinkingLevelMap : undefined,
			};
		});
}

export function rowsValid(rows: ModelRow[]): boolean {
	return rows.every(
		(row) =>
			(!row.contextWindow.trim() || parseTokenCount(row.contextWindow) !== null) &&
			(!row.maxTokens.trim() || parseTokenCount(row.maxTokens) !== null),
	);
}

export function splitPastedModelIds(text: string): [string, ...string[]] | null {
	if (!/[,\n]/.test(text)) return null;
	const ids = text
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
	const [first, ...rest] = ids;
	return first === undefined ? null : [first, ...rest];
}
