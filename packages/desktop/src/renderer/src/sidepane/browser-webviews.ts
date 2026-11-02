const webviews = new Map<string, HTMLElement>();

export function registerBrowserWebview(tabId: string, el: HTMLElement | null): void {
	if (el) {
		if (typeof el.setAttribute === "function") el.setAttribute("data-browser-tab-id", tabId);
		webviews.set(tabId, el);
	} else webviews.delete(tabId);
}

export function listBrowserWebviewIds(): string[] {
	return [...webviews.keys()];
}

export function getBrowserWebview(tabId: string): HTMLElement | null {
	return webviews.get(tabId) ?? null;
}
