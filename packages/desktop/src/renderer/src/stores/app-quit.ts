import { create } from "zustand";
import { getPi } from "../api";

interface AppQuitStore {
	visible: boolean;
}

export const useAppQuitStore = create<AppQuitStore>()(() => ({ visible: false }));

let initialized = false;

export function initAppQuit(): void {
	if (initialized) return;
	initialized = true;
	const pi = getPi();

	if (pi.platform !== "win32") return;
	void pi.setQuitGuard({ enabled: true });

	pi.onQuitRequested(() => useAppQuitStore.setState({ visible: true }));
}
