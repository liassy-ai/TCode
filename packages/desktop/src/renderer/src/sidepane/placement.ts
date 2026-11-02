import { SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";
import { SIDEBAR_WIDTH_PX } from "../lib/layout-metrics";
import { useChatLayoutStore } from "../stores/chat-layout";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { useSidePaneStore } from "./store";
import { sidePaneMaxWidthPx } from "./width";

export function sidebarInFlowWidthPx(): number {
	const ui = useUiPreferencesStore.getState();
	return ui.sidebarCollapsed || ui.autoCollapsed || ui.sidebarFloating ? 0 : SIDEBAR_WIDTH_PX;
}

export function sidePaneFloatsWhenOpen(viewportPx: number): boolean {
	const floorPx = useChatLayoutStore.getState().floorPx;
	if (!floorPx) return false;
	return viewportPx - sidebarInFlowWidthPx() - SIDEPANE_MIN_WIDTH_PX < floorPx;
}

export function commitSidePaneWidth(targetPx: number): number {
	const rail = sidebarInFlowWidthPx();
	const max = sidePaneMaxWidthPx(window.innerWidth, rail, useChatLayoutStore.getState().floorPx);
	const next = Math.min(max, Math.max(SIDEPANE_MIN_WIDTH_PX, Math.round(targetPx)));
	useSidePaneStore.getState().commitWidth(next, window.innerWidth - rail - next);

	return useSidePaneStore.getState().widthPx;
}
