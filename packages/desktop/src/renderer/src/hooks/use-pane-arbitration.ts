import { SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH_PX } from "../lib/layout-metrics";
import { sidePaneFloatsWhenOpen } from "../sidepane/placement";
import { isDockExpanded, useSidePaneStore } from "../sidepane/store";
import { sidePaneMaxWidthPx } from "../sidepane/width";
import { useChatLayoutStore } from "../stores/chat-layout";
import { selectSidebarHidden, useUiPreferencesStore } from "../stores/ui-preferences";

export function usePaneArbitration() {
	const floorPx = useChatLayoutStore((s) => s.floorPx);
	const sidebarHidden = useUiPreferencesStore(selectSidebarHidden);
	const autoCollapsed = useUiPreferencesStore((s) => s.autoCollapsed);
	const sidebarFloating = useUiPreferencesStore((s) => s.sidebarFloating);
	const dockOpen = useSidePaneStore(isDockExpanded);
	const dockWidth = useSidePaneStore((s) => s.widthPx);
	const dockFloating = useSidePaneStore((s) => s.floating);

	const dockResizing = useSidePaneStore((s) => s.resizing);
	const autoShrunkFromPx = useSidePaneStore((s) => s.autoShrunkFromPx);

	const chatWidthPx = useSidePaneStore((s) => s.chatWidthPx);

	const prev = useRef({ sidebarHidden, dockOpen });

	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		const dockOpenInFlow = dockOpen && !dockFloating;
		const justOpenedDock = dockOpenInFlow && !prev.current.dockOpen;
		const justOpenedSidebar = !sidebarHidden && prev.current.sidebarHidden;
		prev.current = { sidebarHidden, dockOpen };
		if (!floorPx) return;

		const dockPx = dockOpenInFlow ? dockWidth : 0;

		if (sidebarFloating && !sidebarHidden && viewportWidth - SIDEBAR_WIDTH_PX - dockPx >= floorPx) {
			useUiPreferencesStore.getState().setSidebarFloating(false);
			return;
		}
		if (autoCollapsed && viewportWidth - SIDEBAR_WIDTH_PX - dockPx >= floorPx) {
			useUiPreferencesStore.getState().setAutoCollapsed(false);
			return;
		}

		if (dockFloating) {
			if (dockOpen && !sidePaneFloatsWhenOpen(viewportWidth)) {
				useSidePaneStore.getState().setFloating(false);
				return;
			}
		}

		const sidebarPx = sidebarHidden || sidebarFloating ? 0 : SIDEBAR_WIDTH_PX;

		if (chatWidthPx === null && !dockFloating) {
			useSidePaneStore.getState().setChatWidthPx(viewportWidth - sidebarPx - dockWidth);
			return;
		}
		if (
			dockOpenInFlow &&
			!dockResizing &&
			chatWidthPx !== null &&
			viewportWidth - sidebarPx - SIDEPANE_MIN_WIDTH_PX >= floorPx
		) {
			useSidePaneStore.getState().setAutoShrunkFromPx(null);
			const maxDock = sidePaneMaxWidthPx(viewportWidth, sidebarPx, floorPx);
			const desired = Math.min(
				maxDock,
				Math.max(SIDEPANE_MIN_WIDTH_PX, viewportWidth - sidebarPx - chatWidthPx),
			);
			if (desired !== dockWidth) useSidePaneStore.getState().previewWidth(desired);
			return;
		}

		if (
			dockOpenInFlow &&
			autoShrunkFromPx !== null &&
			viewportWidth - sidebarPx - autoShrunkFromPx >= floorPx
		) {
			const sidePane = useSidePaneStore.getState();
			sidePane.previewWidth(autoShrunkFromPx);
			sidePane.setAutoShrunkFromPx(null);
			return;
		}
		if (viewportWidth - sidebarPx - dockPx >= floorPx) return;

		if (sidebarFloating) {
			if (dockOpenInFlow) {
				const maxDock = viewportWidth - floorPx;
				if (maxDock >= SIDEPANE_MIN_WIDTH_PX) {
					if (autoShrunkFromPx === null) useSidePaneStore.getState().setAutoShrunkFromPx(dockWidth);
					useSidePaneStore.getState().previewWidth(Math.min(dockWidth, maxDock));
				} else useSidePaneStore.getState().collapse();
			}
			return;
		}

		if (dockOpenInFlow) {
			const maxDock = viewportWidth - sidebarPx - floorPx;
			if (maxDock >= SIDEPANE_MIN_WIDTH_PX) {
				if (autoShrunkFromPx === null) useSidePaneStore.getState().setAutoShrunkFromPx(dockWidth);
				useSidePaneStore.getState().previewWidth(Math.min(dockWidth, maxDock));
				return;
			}

			if (justOpenedSidebar && !justOpenedDock) useSidePaneStore.getState().collapse();
			else if (!sidebarHidden) useUiPreferencesStore.getState().setAutoCollapsed(true);
			else useSidePaneStore.getState().collapse();
			return;
		}

		if (!sidebarHidden) useUiPreferencesStore.getState().setAutoCollapsed(true);
	}, [
		floorPx,
		sidebarHidden,
		autoCollapsed,
		sidebarFloating,
		dockOpen,
		dockWidth,
		dockFloating,
		autoShrunkFromPx,
		chatWidthPx,
		dockResizing,
		viewportWidth,
	]);
}
