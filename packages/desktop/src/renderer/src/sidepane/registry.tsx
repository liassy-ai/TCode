import type { SidePaneTabKind } from "@tcode/shared";
import { SIDEPANE_LAUNCHER_KINDS } from "@tcode/shared";
import { FileCode, FileDiff, Globe, SquareTerminal, UserRound } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { SubagentIcon } from "../components/icons";
import type { MessageKey } from "../i18n";
import type { SidePanePanelProps } from "./panelProps";
import { BrowserPanel } from "./panels/BrowserPanel";
import { CodeViewerPanel } from "./panels/CodeViewerPanel";
import { DiffPanel } from "./panels/DiffPanel";
import { SubagentDirectoryPanel } from "./panels/SubagentDirectoryPanel";
import { SubagentSessionPanel } from "./panels/SubagentSessionPanel";
import { TerminalPanel } from "./panels/TerminalPanel";

interface SidePaneKindMeta {
	labelKey: MessageKey;

	icon: ComponentType<{ size?: number; className?: string }>;

	panel: ComponentType<SidePanePanelProps> | null;

	blockedOn?: MessageKey;
}

export const SIDEPANE_REGISTRY: Record<SidePaneTabKind, SidePaneKindMeta> = {
	diff: {
		labelKey: "sidepane.kind.diff",
		icon: FileDiff,
		panel: DiffPanel,
	},
	terminal: {
		labelKey: "sidepane.kind.terminal",
		icon: SquareTerminal,
		panel: TerminalPanel,
	},
	browser: {
		labelKey: "sidepane.kind.browser",
		icon: Globe,
		panel: BrowserPanel,
	},
	"code-viewer": {
		labelKey: "sidepane.kind.code-viewer",
		icon: FileCode,
		panel: CodeViewerPanel,
	},

	"subagent-directory": {
		labelKey: "sidepane.kind.subagent-directory",
		icon: UserRound,
		panel: SubagentDirectoryPanel,
	},
	"subagent-session": {
		labelKey: "sidepane.kind.subagent-session",

		icon: SubagentIcon,
		panel: SubagentSessionPanel,
	},
};

export const SIDEPANE_OPENABLE_KINDS: readonly SidePaneTabKind[] = SIDEPANE_LAUNCHER_KINDS.filter(
	(kind) => SIDEPANE_REGISTRY[kind].panel !== null,
);

export function SidePaneTabIcon({
	kind,
	size = 13,
	className,
}: {
	kind: SidePaneTabKind;
	size?: number;
	className?: string;
}): ReactNode {
	const Icon = SIDEPANE_REGISTRY[kind].icon;
	return <Icon size={size} className={className} />;
}
