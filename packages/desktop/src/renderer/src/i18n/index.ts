import { createContext, createElement, type ReactNode, useContext } from "react";
import { create } from "zustand";
import { getPi } from "../api";
import { en } from "./en";
import { type Messages, zh } from "./zh";

export type Language = "zh" | "en";

export type LanguageMode = Language | "chat-en";

const STORAGE_KEY = "pi-desktop.lang";
const dictionaries: Record<Language, Messages> = { zh, en };

export function chromeLanguage(mode: LanguageMode): Language {
	return mode === "en" ? "en" : "zh";
}

export function chatLanguage(mode: LanguageMode): Language {
	return mode === "zh" ? "zh" : "en";
}

function detectLanguage(): LanguageMode {
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved === "zh" || saved === "en" || saved === "chat-en") return saved;
	return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function reportLanguage(mode: LanguageMode): void {
	if (typeof window === "undefined") return;
	try {
		void Promise.resolve(
			getPi().setUiLanguage({ language: chromeLanguage(mode), chatLanguage: chatLanguage(mode) }),
		).catch(() => undefined);
	} catch {
		return;
	}
}

interface I18nStore {
	language: LanguageMode;
	setLanguage: (language: LanguageMode) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
	language: detectLanguage(),
	setLanguage: (language) => {
		localStorage.setItem(STORAGE_KEY, language);
		reportLanguage(language);
		set({ language });
	},
}));

reportLanguage(useI18nStore.getState().language);

const ChatLanguageContext = createContext<Language | null>(null);

export function LanguageScope({ children }: { children: ReactNode }) {
	const mode = useI18nStore((s) => s.language);
	return createElement(ChatLanguageContext.Provider, { value: chatLanguage(mode) }, children);
}

export function useScopedLanguage(): Language {
	const mode = useI18nStore((s) => s.language);
	const scoped = useContext(ChatLanguageContext);
	return scoped ?? chromeLanguage(mode);
}

type DotKeys<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DotKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = DotKeys<Messages>;

function resolve(messages: Messages, key: string): string {
	let node: unknown = messages;
	for (const part of key.split(".")) {
		node = (node as Record<string, unknown>)[part];
		if (node === undefined) return key;
	}
	return typeof node === "string" ? node : key;
}

export function translate(
	language: Language,
	key: MessageKey,
	params?: Record<string, string | number>,
): string {
	const template = resolve(dictionaries[language], key);
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function useT() {
	const language = useScopedLanguage();
	return (key: MessageKey, params?: Record<string, string | number>) => translate(language, key, params);
}

export type Translate = ReturnType<typeof useT>;
