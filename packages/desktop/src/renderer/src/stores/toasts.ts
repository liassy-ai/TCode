import { create } from "zustand";
import type { MessageKey } from "../i18n";

export type ToastSeverity = "error" | "warning" | "info";

export interface AppToast {
	id: string;
	severity: ToastSeverity;

	titleKey?: MessageKey;

	titleText?: string;

	detail?: string;
	timestamp: number;
}

interface ToastsState {
	toasts: AppToast[];

	overflowCount: number;
	push: (severity: ToastSeverity, titleKey: MessageKey, detail?: string) => void;

	pushExtension: (severity: ToastSeverity, message: string, source?: string) => void;
	dismiss: (id: string) => void;
}

let nextToastId = 0;
const TOAST_TTL_MS = 4500;

const DEDUP_WINDOW_MS = 8000;

const EXT_VISIBLE_CAP = 3;

const DEDUP_MAX_ENTRIES = 256;

const recentExtensionToasts = new Map<string, number>();

export const useToastsStore = create<ToastsState>()((set, get) => ({
	toasts: [],
	overflowCount: 0,
	push: (severity, titleKey, detail) => {
		const toast: AppToast = {
			id: `toast${nextToastId++}`,
			severity,
			titleKey,
			detail,
			timestamp: Date.now(),
		};
		set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }));
		setTimeout(() => get().dismiss(toast.id), TOAST_TTL_MS);
	},
	pushExtension: (severity, message, source) => {
		const now = Date.now();
		const dedupKey = `${source ?? ""}|${message}`;
		const last = recentExtensionToasts.get(dedupKey);
		if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;
		recentExtensionToasts.set(dedupKey, now);
		if (recentExtensionToasts.size > DEDUP_MAX_ENTRIES) {
			for (const [key, at] of recentExtensionToasts) {
				if (now - at >= DEDUP_WINDOW_MS) recentExtensionToasts.delete(key);
			}
			if (recentExtensionToasts.size > DEDUP_MAX_ENTRIES) recentExtensionToasts.clear();
		}
		const toast: AppToast = {
			id: `toast${nextToastId++}`,
			severity,
			titleText: message,
			...(source ? { detail: source } : {}),
			timestamp: now,
		};
		set((state) => {
			const visible = state.toasts.filter((t) => t.titleText !== undefined);
			let toasts = state.toasts;
			let overflowCount = state.overflowCount;

			const oldest = visible[0];
			if (visible.length >= EXT_VISIBLE_CAP && oldest) {
				toasts = toasts.filter((t) => t.id !== oldest.id);
				overflowCount += 1;
			}
			return { toasts: [...toasts, toast], overflowCount };
		});
		setTimeout(() => get().dismiss(toast.id), TOAST_TTL_MS);
	},
	dismiss: (id) => {
		set((state) => {
			const toast = state.toasts.find((t) => t.id === id);
			if (!toast) return state;

			const overflowCount =
				toast.titleText !== undefined ? Math.max(0, state.overflowCount - 1) : state.overflowCount;
			return { toasts: state.toasts.filter((t) => t.id !== id), overflowCount };
		});
	},
}));

export const pushToast = (severity: ToastSeverity, titleKey: MessageKey, detail?: string) =>
	useToastsStore.getState().push(severity, titleKey, detail);

export const pushExtensionToast = (severity: ToastSeverity, message: string, source?: string) =>
	useToastsStore.getState().pushExtension(severity, message, source);
