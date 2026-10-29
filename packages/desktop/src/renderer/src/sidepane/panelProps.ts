import type { SidePaneTabSnapshot } from "@tcode/shared";
import type { Translate } from "../i18n";

export interface SidePanePanelProps {
	tab: SidePaneTabSnapshot;

	cwd: string;

	sessionId: string | null;

	visible: boolean;
	t: Translate;
}
