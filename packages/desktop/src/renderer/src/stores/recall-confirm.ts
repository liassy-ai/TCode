import { create } from "zustand";
import type { MenuAnchor } from "../components/ui/place-menu";

interface RecallConfirmState {
	files: string[] | null;
	anchor: MenuAnchor | null;
	ask: (files: string[], anchor: MenuAnchor) => Promise<boolean>;
	settle: (ok: boolean) => void;
}

let settleFn: ((ok: boolean) => void) | null = null;

export const useRecallConfirmStore = create<RecallConfirmState>((set) => ({
	files: null,
	anchor: null,
	ask: (files, anchor) =>
		new Promise<boolean>((resolve) => {
			settleFn = resolve;
			set({ files, anchor });
		}),
	settle: (ok) => {
		const fn = settleFn;
		settleFn = null;
		set({ files: null, anchor: null });
		fn?.(ok);
	},
}));
