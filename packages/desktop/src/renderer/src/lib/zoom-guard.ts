const ZOOM_GUARD_FLAG = "__tcodeZoomGuard";

const guardWindow = window as Window & { __tcodeZoomGuard?: boolean };

if (!guardWindow[ZOOM_GUARD_FLAG]) {
	guardWindow[ZOOM_GUARD_FLAG] = true;
	window.addEventListener(
		"wheel",
		(event) => {
			if (event.ctrlKey) event.preventDefault();
		},
		{ passive: false, capture: true },
	);
	for (const type of ["gesturestart", "gesturechange", "gestureend"] as const) {
		window.addEventListener(type, (event: Event) => event.preventDefault());
	}
}
