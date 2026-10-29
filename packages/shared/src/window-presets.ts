export interface WindowPreset {
	id: string;
	width: number;
	height: number;
}

export const WINDOW_PRESETS: readonly WindowPreset[] = [{ id: "desktop", width: 1280, height: 800 }];

export const DEFAULT_WINDOW_PRESET: WindowPreset = WINDOW_PRESETS[0] as WindowPreset;

export function windowPresetById(id: string): WindowPreset | null {
	const key = id.trim().toLowerCase();
	return WINDOW_PRESETS.find((preset) => preset.id === key) ?? null;
}

export function describeWindowPresets(): string {
	return WINDOW_PRESETS.map((preset) => `${preset.id} = ${preset.width}×${preset.height}`).join("、");
}
