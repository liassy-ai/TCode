export interface BrowserControlRequest {
	id: string;

	sessionId: string;
	op:
		| "list"
		| "read"
		| "open"
		| "reload"
		| "click"
		| "type"
		| "script"
		| "keys"
		| "resize"
		| "cdp"
		| "screenshot"
		| "console"
		| "wait"
		| "hover"
		| "scroll"
		| "close";

	tabId?: string;

	url?: string;

	newTab?: boolean;

	selector?: string;

	index?: number;

	text?: string;

	submit?: boolean;

	code?: string;

	format?: "text" | "html";

	key?: string;

	modifiers?: ("ctrl" | "alt" | "shift" | "meta")[];

	width?: number;

	height?: number;

	reset?: boolean;

	method?: string;
	params?: Record<string, unknown>;

	clear?: boolean;

	idle?: "load" | "network";
	timeout?: number;

	dx?: number;
	dy?: number;
	behavior?: "auto" | "smooth";

	fullPage?: boolean;

	all?: boolean;
}

export interface BrowserControlTabInfo {
	id: string;
	title: string;
	url: string;

	current?: boolean;

	active?: boolean;
}

export type BrowserControlResult =
	| { ok: true; kind: "tabs"; tabs: BrowserControlTabInfo[] }
	| { ok: true; kind: "page"; url: string; title: string; text: string; truncated: boolean }
	| { ok: true; kind: "opened"; tabId: string; url: string; loaded: boolean }
	| { ok: true; kind: "reloaded"; tabId: string; url: string; title: string; loaded: boolean }
	| {
			ok: true;
			kind: "acted";
			tabId: string;
			action: "click" | "type" | "script" | "keys" | "hover" | "scroll" | "wait" | "close";
			detail: string;
			truncated: boolean;
	  }
	| { ok: true; kind: "resized"; tabId: string; width?: number; height?: number; reset: boolean }
	| { ok: true; kind: "cdp"; tabId: string; method: string; result: string }
	| { ok: true; kind: "logs"; tabId: string; logs: { level: string; text: string }[]; dropped: number }
	| { ok: true; kind: "shot"; tabId: string; webContentsId: number; width: number; height: number }
	| { ok: false; error: string };
