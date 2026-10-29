import { create } from "zustand";

export interface DiffFocus {
	sectionKey: string;
	nonce: number;
}

interface UiStore {
	todoExpanded: Record<string, boolean>;
	toggleTodoExpanded: (sessionId: string) => void;

	diffFocus: DiffFocus | null;
	setDiffFocus: (sectionKey: string) => void;
	clearDiffFocus: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
	todoExpanded: {},
	toggleTodoExpanded: (sessionId) =>
		set((state) => ({
			todoExpanded: { ...state.todoExpanded, [sessionId]: !state.todoExpanded[sessionId] },
		})),
	diffFocus: null,
	setDiffFocus: (sectionKey) =>
		set((state) => ({ diffFocus: { sectionKey, nonce: (state.diffFocus?.nonce ?? 0) + 1 } })),
	clearDiffFocus: () => set({ diffFocus: null }),
}));
