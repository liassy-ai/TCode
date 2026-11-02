import type { ImageInput } from "@tcode/shared";
import { create } from "zustand";

export const NEW_SESSION_DRAFT_KEY = "__new__";

export const COMPOSER_FOCUS_EVENT = "pi:composer-focus";

export const ANNOTATION_EDIT_EVENT = "pi:annotation-edit";

export interface DraftAnnotation {
	id: string;

	command: string;
}

export interface DraftEntry {
	text: string;
	images: ImageInput[];
	slashCommand: string | null;

	attachments: string[];

	quotes: string[];

	annotations: DraftAnnotation[];
}

export const EMPTY_DRAFT: DraftEntry = {
	text: "",
	images: [],
	slashCommand: null,
	attachments: [],
	quotes: [],
	annotations: [],
};

interface DraftStore {
	bySession: Record<string, DraftEntry>;

	updateDraft: (key: string, updater: (entry: DraftEntry) => DraftEntry) => void;
}

function isEmpty(entry: DraftEntry): boolean {
	return (
		!entry.text &&
		entry.images.length === 0 &&
		!entry.slashCommand &&
		entry.attachments.length === 0 &&
		entry.quotes.length === 0 &&
		entry.annotations.length === 0
	);
}

export const useDraftStore = create<DraftStore>((set) => ({
	bySession: {},
	updateDraft: (key, updater) =>
		set((state) => {
			const next = updater(state.bySession[key] ?? EMPTY_DRAFT);
			if (isEmpty(next)) {
				if (!(key in state.bySession)) return state;
				const rest = { ...state.bySession };
				delete rest[key];
				return { bySession: rest };
			}
			return { bySession: { ...state.bySession, [key]: next } };
		}),
}));
