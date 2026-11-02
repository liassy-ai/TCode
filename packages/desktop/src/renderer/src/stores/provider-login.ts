import type { LoginAuthPrompt, ProviderInfo } from "@tcode/shared";
import { create } from "zustand";
import { getPi } from "../api";
import { useSessionsStore } from "./sessions";
import { useSettingsStore } from "./settings";

export interface LoginFlowState {
	loginId: string;
	providerId: string;
	providerName: string;

	loginKind?: "oauth" | "apiKey";

	statusLine?: string;

	infoLinks?: readonly { url: string; label?: string }[];

	authUrl?: { url: string; instructions?: string };

	deviceCode?: { userCode: string; verificationUri: string; expiresInSeconds?: number };

	pendingPrompt?: { promptId: string; prompt: LoginAuthPrompt };

	error?: string;
}

interface ProviderLoginStore {
	login: LoginFlowState | null;

	startProviderLogin: (provider: ProviderInfo) => Promise<void>;

	respondLoginPrompt: (value: string) => void;

	cancelProviderLogin: () => void;

	dismissLogin: () => void;
}

export const useProviderLoginStore = create<ProviderLoginStore>((set, get) => ({
	login: null,

	startProviderLogin: async (provider) => {
		if (get().login) return;
		const loginId = `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		set({
			login: {
				loginId,
				providerId: provider.id,
				providerName: provider.name,
				loginKind: provider.oauth ? "oauth" : provider.apiKeyLogin ? "apiKey" : undefined,
			},
		});

		let browserOpened = false;

		const unsubscribe = getPi().onProviderLoginEvent((payload) => {
			if (payload.loginId !== loginId) return;
			const state = get().login;
			if (!state || state.loginId !== loginId) return;
			if (payload.kind === "prompt") {
				set({ login: { ...state, pendingPrompt: { promptId: payload.promptId, prompt: payload.prompt } } });
				return;
			}
			if (payload.kind === "prompt-cancel") {
				if (state.pendingPrompt?.promptId === payload.promptId) {
					set({ login: { ...state, pendingPrompt: undefined } });
				}
				return;
			}
			const event = payload.event;
			if (event.type === "auth_url") {
				set({ login: { ...state, authUrl: { url: event.url, instructions: event.instructions } } });
				if (!browserOpened) {
					browserOpened = true;
					void getPi().openExternal({ url: event.url });
				}
			} else if (event.type === "device_code") {
				set({
					login: {
						...state,
						deviceCode: {
							userCode: event.userCode,
							verificationUri: event.verificationUri,
							expiresInSeconds: event.expiresInSeconds,
						},
					},
				});
			} else if (event.type === "progress") {
				set({ login: { ...state, statusLine: event.message } });
			} else if (event.type === "info") {
				set({ login: { ...state, statusLine: event.message, infoLinks: event.links } });
			}
		});
		try {
			const result = await getPi().startProviderLogin({ loginId, providerId: provider.id });
			if (result.ok) {
				set({ login: null });

				await useSettingsStore.getState().refresh();
				await useSessionsStore.getState().loadModels();
			} else if (result.cancelled) {
				set({ login: null });
			} else {
				const state = get().login;
				if (state) {
					set({
						login: { ...state, pendingPrompt: undefined, error: result.error ?? "unknown error" },
					});
				}
			}
		} catch (error) {
			const state = get().login;
			if (state) {
				set({
					login: {
						...state,
						pendingPrompt: undefined,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
		} finally {
			unsubscribe();
		}
	},

	respondLoginPrompt: async (value) => {
		const state = get().login;
		if (!state?.pendingPrompt) return;
		const { promptId } = state.pendingPrompt;
		try {
			await getPi().respondProviderLogin({ loginId: state.loginId, promptId, value });
			set((s) => {
				if (!s.login?.pendingPrompt || s.login.pendingPrompt.promptId !== promptId) return {};
				return { login: { ...s.login, pendingPrompt: undefined } };
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			set((s) => (s.login ? { login: { ...s.login, error: message } } : {}));
		}
	},

	cancelProviderLogin: () => {
		const state = get().login;
		if (!state) return;
		void getPi().cancelProviderLogin({ loginId: state.loginId });
	},

	dismissLogin: () => set({ login: null }),
}));
