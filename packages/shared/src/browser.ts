export const BROWSER_PARTITION = "persist:tcode-browser";

export interface BrowserTabState {
	url: string;
	title: string;

	favicon: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;

	failed: boolean;
}

export function isAllowedBrowserUrl(url: string): boolean {
	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase() ?? "";
	return scheme === "http" || scheme === "https" || scheme === "about" || scheme === "file";
}

export function normalizeBrowserUrl(raw: string): string {
	const text = raw.trim();
	if (text === "") return "about:blank";

	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/.test(text)) return text;

	const ipLiteral = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/;
	const localhost = /^localhost(:\d+)?(\/|$)/i;
	const explicitPort = /^[^/]*(:\d+)(\/|$)/;
	const looksLocal = ipLiteral.test(text) || localhost.test(text) || explicitPort.test(text);
	return `${looksLocal ? "http" : "https"}://${text}`;
}
