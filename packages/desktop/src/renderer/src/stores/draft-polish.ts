import { create } from "zustand";

interface DraftPolishState {
	polishing: boolean;

	setPolishing: (value: boolean) => void;
}

export const useDraftPolishStore = create<DraftPolishState>((set) => ({
	polishing: false,

	setPolishing: (value) => set({ polishing: value }),
}));
