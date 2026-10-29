import { DiffSidebarContent } from "../../components/diff/DiffSidebarContent";
import type { SidePanePanelProps } from "../panelProps";

export function DiffPanel(_props: SidePanePanelProps) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			<DiffSidebarContent />
		</div>
	);
}
