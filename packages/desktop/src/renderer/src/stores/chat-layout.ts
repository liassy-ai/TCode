import { create } from "zustand";

export const useChatLayoutStore = create<{ floorPx: number; setFloorPx: (px: number) => void }>(
	(set, get) => ({
		floorPx: 0,

		setFloorPx: (px) => {
			const capped = Math.min(Math.ceil(px), window.innerWidth);
			if (Math.abs(get().floorPx - capped) <= 1) return;
			set({ floorPx: capped });
		},
	}),
);
