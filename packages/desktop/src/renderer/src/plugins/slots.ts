import type { SubagentRunUi, UIToolCall } from "@tcode/shared";

export const UI_SLOTS = {
	ToolCallCard: "chat.tool-call-card",
	SubagentCard: "chat.subagent-card",
	TodoPanel: "chat.todo-panel",
} as const;
export type SlotName = (typeof UI_SLOTS)[keyof typeof UI_SLOTS];

export const UI_REGIONS = {
	AppBackground: "app.background",
	AppOverlay: "app.overlay",
	CornerTopLeft: "chat.corner.top-left",
	CornerTopRight: "chat.corner.top-right",
	CornerBottomLeft: "chat.corner.bottom-left",
	CornerBottomRight: "chat.corner.bottom-right",

	ComposerFooter: "composer.footer",
	SettingsPanel: "settings.panel",
} as const;
export type RegionName = (typeof UI_REGIONS)[keyof typeof UI_REGIONS];

export interface SlotPropsMap {
	[UI_SLOTS.ToolCallCard]: { tool: UIToolCall; subCallsOf?: (parentId: string) => UIToolCall[] };
	[UI_SLOTS.SubagentCard]: { runs: SubagentRunUi[] };
	[UI_SLOTS.TodoPanel]: Record<string, never>;
}
