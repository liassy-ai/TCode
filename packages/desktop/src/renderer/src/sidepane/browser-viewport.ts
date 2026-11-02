import { DEFAULT_WINDOW_PRESET } from "@tcode/shared";
import { create } from "zustand";

export type ViewportFrame = "auto" | "desktop";

type ViewportMode = "fit" | "manual";

export interface BrowserViewportOverride {
	width: number;
	height: number;

	source?: "ai" | "user";
}

interface ViewportZoomValues {
	auto: number;

	desktop: number;
}

export const DEFAULT_ZOOM_VALUES: ViewportZoomValues = { auto: 0.8, desktop: 1 };

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export const ZOOM_STEP = 0.1;

export function clampZoom(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export const DESKTOP_SIZE = {
	width: DEFAULT_WINDOW_PRESET.width,
	height: DEFAULT_WINDOW_PRESET.height,
} as const;

export const DESKTOP_SIZE_LABEL = `${DESKTOP_SIZE.width}×${DESKTOP_SIZE.height}`;

export const DESKTOP_FRAME = "desktop" as const;

export function frameChoiceFor(mode: ViewportMode, frame: ViewportFrame): ViewportFrame {
	return mode === "fit" ? "auto" : frame;
}

export function isAutoFrame(mode: ViewportMode, frame: ViewportFrame): boolean {
	return frameChoiceFor(mode, frame) === "auto";
}

export function isDesktopFrame(mode: ViewportMode, frame: ViewportFrame): boolean {
	return frameChoiceFor(mode, frame) === DESKTOP_FRAME;
}

export function frameSizeFor(
	override: BrowserViewportOverride | undefined,
	choice: ViewportFrame,
	available: { width: number; height: number },
): { width: number; height: number } {
	if (choice === DESKTOP_FRAME) {
		return {
			width: override?.width ?? DESKTOP_SIZE.width,
			height: override?.height ?? DESKTOP_SIZE.height,
		};
	}
	return { width: available.width, height: available.height };
}

export function zoomValueFor(mode: ViewportMode, frame: ViewportFrame, values: ViewportZoomValues): number {
	return values[frameChoiceFor(mode, frame)];
}

export function pageZoomFor(mode: ViewportMode, frame: ViewportFrame, values: ViewportZoomValues): number {
	if (mode === "fit") return 1;
	return clampZoom(values[frameChoiceFor(mode, frame)]);
}

interface BrowserViewportState {
	overrides: Record<string, BrowserViewportOverride>;

	frames: Record<string, ViewportFrame>;

	zoomValues: Record<string, ViewportZoomValues>;
	modes: Record<string, ViewportMode>;
	setOverride: (tabId: string, override: BrowserViewportOverride) => void;
	clearOverride: (tabId: string) => void;
	setFrame: (tabId: string, frame: ViewportFrame) => void;

	setZoomValue: (tabId: string, frame: ViewportFrame, value: number) => void;
	setMode: (tabId: string, mode: ViewportMode) => void;
}

export const useBrowserViewportStore = create<BrowserViewportState>((set) => ({
	overrides: {},
	frames: {},
	zoomValues: {},
	modes: {},
	setOverride: (tabId, override) =>
		set((state) => ({ overrides: { ...state.overrides, [tabId]: override } })),
	clearOverride: (tabId) =>
		set((state) => {
			if (!(tabId in state.overrides)) return state;
			const next = { ...state.overrides };
			delete next[tabId];
			return { overrides: next };
		}),
	setFrame: (tabId, frame) => set((state) => ({ frames: { ...state.frames, [tabId]: frame } })),
	setZoomValue: (tabId, frame, value) =>
		set((state) => {
			const current = state.zoomValues[tabId] ?? DEFAULT_ZOOM_VALUES;
			return {
				zoomValues: { ...state.zoomValues, [tabId]: { ...current, [frame]: clampZoom(value) } },
			};
		}),
	setMode: (tabId, mode) => set((state) => ({ modes: { ...state.modes, [tabId]: mode } })),
}));

export function zoomValuesOf(tabId: string): ViewportZoomValues {
	return useBrowserViewportStore.getState().zoomValues[tabId] ?? DEFAULT_ZOOM_VALUES;
}

export function autoZoomFor(availWidth: number, availHeight: number, width: number, height: number): number {
	if (!(availWidth > 0) || !(availHeight > 0) || !(width > 0) || !(height > 0)) return 1;
	return Math.max(0.05, Math.min(1, availWidth / width, availHeight / height));
}
