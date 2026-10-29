const MIN_DISPLAY_MS = 2500;

const MAX_DISPLAY_MS = 4500;

const EXIT_MS = 2400;
const EXIT_MS_REDUCED = 300;

const PLAYED_KEY = "pi-splash-played";

let finished = false;

function markPlayed(): void {
	try {
		sessionStorage.setItem(PLAYED_KEY, "1");
	} catch {}
}

function alreadyPlayed(): boolean {
	try {
		return sessionStorage.getItem(PLAYED_KEY) === "1";
	} catch {
		return false;
	}
}

function removeSplash(): void {
	document.getElementById("splash")?.remove();
}

export function initSplash(): void {
	if (alreadyPlayed()) {
		finished = true;

		document.documentElement.dataset.appReady = "true";
		removeSplash();
		return;
	}
	window.setTimeout(finishSplash, MAX_DISPLAY_MS);
}

export function finishSplash(): void {
	if (finished) return;
	finished = true;
	markPlayed();
	const wait = Math.max(0, MIN_DISPLAY_MS - performance.now());
	window.setTimeout(() => {
		document.documentElement.dataset.appReady = "true";
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		window.setTimeout(removeSplash, reduced ? EXIT_MS_REDUCED : EXIT_MS);
	}, wait);
}
