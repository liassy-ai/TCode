import { type Language, useScopedLanguage } from "../i18n";

export function useLanguage(): Language {
	return useScopedLanguage();
}
