import { useCallback } from "react";
import { toggleExpandedGroup } from "../../lib/sidebar-groups";
import { useUiPreferencesStore } from "../../stores/ui-preferences";

export function useExpandedGroups() {
	const setExpandedGroups = useUiPreferencesStore((s) => s.setExpandedGroups);
	const toggleGroup = useCallback(
		(key: string, defaults: readonly string[]) => {
			const { expandedGroups, expandedGroupsTouched } = useUiPreferencesStore.getState();
			setExpandedGroups(toggleExpandedGroup(expandedGroups, key, defaults, expandedGroupsTouched));
		},
		[setExpandedGroups],
	);
	return { toggleGroup };
}
