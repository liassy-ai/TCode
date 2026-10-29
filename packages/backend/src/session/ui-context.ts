import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionDialogHost } from "./extension-dialog-host";

const EXTENSION_THEME = new Theme(
	{
		accent: "#7aa2f7",
		border: "#3b4261",
		borderAccent: "#7aa2f7",
		borderMuted: "#292e42",
		success: "#9ece6a",
		error: "#f7768e",
		warning: "#e0af68",
		muted: "#78849b",
		dim: "#565f89",
		text: "#c0caf5",
		thinkingText: "#9d7cd8",
		userMessageText: "#c0caf5",
		customMessageText: "#c0caf5",
		customMessageLabel: "#7aa2f7",
		toolTitle: "#7dcfff",
		toolOutput: "#a9b1d6",
		mdHeading: "#7aa2f7",
		mdLink: "#7dcfff",
		mdLinkUrl: "#565f89",
		mdCode: "#9ece6a",
		mdCodeBlock: "#a9b1d6",
		mdCodeBlockBorder: "#3b4261",
		mdQuote: "#a9b1d6",
		mdQuoteBorder: "#3b4261",
		mdHr: "#3b4261",
		mdListBullet: "#7dcfff",
		toolDiffAdded: "#9ece6a",
		toolDiffRemoved: "#f7768e",
		toolDiffContext: "#565f89",
		syntaxComment: "#565f89",
		syntaxKeyword: "#bb9af7",
		syntaxFunction: "#7aa2f7",
		syntaxVariable: "#e0af68",
		syntaxString: "#9ece6a",
		syntaxNumber: "#ff9e64",
		syntaxType: "#2ac3de",
		syntaxOperator: "#89ddff",
		syntaxPunctuation: "#c0caf5",
		thinkingOff: "#565f89",
		thinkingMinimal: "#6183bb",
		thinkingLow: "#7aa2f7",
		thinkingMedium: "#89ddff",
		thinkingHigh: "#b4f9f8",
		thinkingXhigh: "#d2e5ff",
		bashMode: "#e0af68",
	},
	{
		selectedBg: "#33467c",
		userMessageBg: "#24283b",
		customMessageBg: "#1f2335",
		toolPendingBg: "#2f334d",
		toolSuccessBg: "#20303b",
		toolErrorBg: "#2d202a",
	},
	"truecolor",
	{ name: "tcode-desktop" },
);

export function extensionNameFromStack(stack: string): string {
	for (const line of stack.split("\n")) {
		if (
			line.includes("@earendil-works") ||
			line.includes("node_modules/jiti/") ||
			line.includes("ui-context")
		) {
			continue;
		}
		const ext = line.match(/\/extensions\/([^/()\s]+?)\.(?:tsx?|mjs|cjs|js)(?:[?#:]|$)/);
		if (ext?.[1] && ext[1] !== "index") return ext[1];
		const pkg = line.match(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//);
		if (pkg?.[1]) return pkg[1];
	}
	return "";
}

export interface UiContextDeps {
	dialogs?: ExtensionDialogHost;

	onNotify?: (message: string, level: "info" | "warning" | "error", source: string) => void;

	onEditorText?: (text: string, source: string) => void;
}

export function makeUiContext(deps: UiContextDeps = {}): ExtensionUIContext {
	return {
		select: (title, options, opts) =>
			deps.dialogs
				? deps.dialogs
						.ask("select", { title, options }, opts)
						.then((v) => (typeof v === "string" ? v : undefined))
				: Promise.resolve(undefined),
		confirm: (title, message, opts) =>
			deps.dialogs
				? deps.dialogs.ask("confirm", { title, message }, opts).then((v) => v === true)
				: Promise.resolve(false),
		input: (title, placeholder, opts) =>
			deps.dialogs
				? deps.dialogs
						.ask("input", placeholder ? { title, placeholder } : { title }, opts)
						.then((v) => (typeof v === "string" ? v : undefined))
				: Promise.resolve(undefined),
		notify: (message, type) =>
			deps.onNotify?.(message, type ?? "info", extensionNameFromStack(new Error().stack ?? "")),
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: (async () => undefined) as ExtensionUIContext["custom"],
		pasteToEditor: (text) => deps.onEditorText?.(text, extensionNameFromStack(new Error().stack ?? "")),
		setEditorText: (text) => deps.onEditorText?.(text, extensionNameFromStack(new Error().stack ?? "")),

		getEditorText: () => "",
		editor: (title, prefill) =>
			deps.dialogs
				? deps.dialogs
						.ask("editor", prefill ? { title, prefill } : { title }, undefined)
						.then((v) => (typeof v === "string" ? v : undefined))
				: Promise.resolve(undefined),
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: EXTENSION_THEME,
		getAllThemes: () => [],
		getTheme: () => undefined,

		setTheme: () => ({ success: false, error: "Theme switching is managed by TCode" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
