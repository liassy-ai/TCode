import { create } from "zustand";

export const useCheckpointsStore = create<{ version: number; bump: () => void }>((set) => ({
	version: 0,
	bump: () => set((s) => ({ version: s.version + 1 })),
}));
