import type { UiState } from "@tcode/shared";
import { getPi } from "../api";
import { useSidePaneStore } from "../sidepane/store";
import { useThemeStore } from "../stores/theme";
import { useUiPreferencesStore } from "../stores/ui-preferences";

export function startUiStateSync(): () => void {
	return getPi().onUiStateChanged((patch: Partial<UiState>) => {
		if (!patch) return;
		useUiPreferencesStore.getState().applyExternalPatch(patch);
		useThemeStore.getState().applyExternalPatch(patch);
		if (patch.sidePane !== undefined) useSidePaneStore.getState().hydrate(patch.sidePane);
	});
}
