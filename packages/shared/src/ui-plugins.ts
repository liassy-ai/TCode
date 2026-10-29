export const KNOWN_UI_SLOTS: string[] = ["chat.tool-call-card", "chat.subagent-card", "chat.todo-panel"];

export const KNOWN_UI_REGIONS: string[] = [
	"app.background",
	"app.overlay",
	"chat.corner.top-left",
	"chat.corner.top-right",
	"chat.corner.bottom-left",
	"chat.corner.bottom-right",
	"composer.footer",
	"settings.panel",
];

export const UI_PLUGIN_ANCHORS = [
	"top-left",
	"top-center",
	"top-right",
	"center-left",
	"center",
	"center-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
] as const;
export type UiPluginAnchor = (typeof UI_PLUGIN_ANCHORS)[number];

export interface UiPluginContribution {
	id: string;

	region: string;

	export: string;

	anchor?: UiPluginAnchor;

	title?: string;
}

export interface UiPluginManifest {
	name: string;

	tcodeUi: number;

	main: string;

	slots?: Record<string, string>;

	contributions?: UiPluginContribution[];

	headless?: boolean;

	version?: string;
	displayName?: string;
	description?: string;
}

export interface UiPluginInfo {
	name: string;
	displayName?: string;
	description?: string;
	version?: string;
	tcodeUi?: number;

	slots: Record<string, string>;

	contributions: UiPluginContribution[];

	headless?: boolean;
	enabled: boolean;
	trusted: boolean;

	invalidReason?: string;

	buildError?: string;

	built: boolean;

	builtin?: boolean;
}

export interface UiPluginsConfig {
	enabled: boolean;
	plugins: Record<
		string,
		{
			enabled: boolean;

			trusted: boolean;
		}
	>;

	assignments: Record<string, string>;
}

export type UiPluginsEventPayload = { kind: "changed"; name: string } | { kind: "config" };
