import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../i18n";
import { clampSidebarWidth } from "../../lib/layout-metrics";
import { useUiPreferencesStore } from "../../stores/ui-preferences";

interface SidebarResizerProps {
	asideRef: { readonly current: HTMLElement | null };
}

export function SidebarResizer({ asideRef }: SidebarResizerProps) {
	const t = useT();

	const stepSidebarWidth = (delta: number) => {
		const store = useUiPreferencesStore.getState();
		store.setSidebarWidth(store.sidebarWidth + delta, true);
	};

	const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		stepSidebarWidth(event.key === "ArrowRight" ? 24 : -24);
	};

	const onResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const aside = asideRef.current;
		const startX = event.clientX;
		const startWidth = useUiPreferencesStore.getState().sidebarWidth;
		let pending = startWidth;
		let frame = 0;

		event.currentTarget.setPointerCapture(event.pointerId);
		aside?.setAttribute("data-resizing", "true");
		document.body.style.setProperty("cursor", "col-resize");

		const apply = () => {
			frame = 0;
			document.documentElement.style.setProperty("--sidebar-width", `${pending}px`);
			useUiPreferencesStore.getState().setSidebarWidthPreview(pending);
		};

		const onMove = (moveEvent: PointerEvent) => {
			pending = clampSidebarWidth(startWidth + (moveEvent.clientX - startX));
			if (!frame) frame = requestAnimationFrame(apply);
		};
		const onEnd = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onEnd);
			window.removeEventListener("pointercancel", onEnd);
			window.removeEventListener("blur", onEnd);
			if (frame) cancelAnimationFrame(frame);
			const handle = event.currentTarget;
			if (handle?.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
			aside?.removeAttribute("data-resizing");
			document.body.style.removeProperty("cursor");
			useUiPreferencesStore.getState().setSidebarWidth(pending, true);
			useUiPreferencesStore.getState().setSidebarWidthPreview(null);
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onEnd);
		window.addEventListener("pointercancel", onEnd);
		window.addEventListener("blur", onEnd);
	};

	const onResizeHover = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const aside = asideRef.current;
		if (!aside) return;
		const rect = aside.getBoundingClientRect();
		aside.style.setProperty("--sidebar-hover-y", `${Math.round(event.clientY - rect.top)}px`);
	};

	return (
		<button
			type="button"
			aria-label={t("sidebar.resizeWidth")}
			title={t("sidebar.resizeWidth")}
			className="sidebar-resizer absolute inset-y-0 right-0 z-30 m-0 w-1 cursor-col-resize appearance-none border-none bg-transparent p-0 outline-none focus-visible:bg-hover"
			onPointerDown={onResizeStart}
			onPointerMove={onResizeHover}
			onKeyDown={onResizeKeyDown}
		/>
	);
}
