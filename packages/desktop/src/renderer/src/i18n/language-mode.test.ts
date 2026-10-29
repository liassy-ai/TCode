import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "pi-desktop.lang" ? "chat-en" : null),
		setItem: () => {},
	});
	vi.stubGlobal("navigator", { language: "zh-CN" });

	return { reported: [] as Array<{ language: string; chatLanguage?: string }> };
});
vi.mock("../api", () => ({
	getPi: () => ({
		setUiLanguage: (arg: { language: string; chatLanguage?: string }) => {
			mocks.reported.push(arg);
			return Promise.resolve();
		},
	}),
}));

import {
	chatLanguage,
	chromeLanguage,
	type Language,
	LanguageScope,
	translate,
	useI18nStore,
	useScopedLanguage,
	useT,
} from ".";

describe("三档语言（中文 / English / 仅会话英文）", () => {
	it("storage 里存过 chat-en：启动即识别", () => {
		expect(useI18nStore.getState().language).toBe("chat-en");
	});

	it("chromeLanguage / chatLanguage 按档位映射", () => {
		expect(chromeLanguage("zh")).toBe("zh");
		expect(chromeLanguage("en")).toBe("en");
		expect(chromeLanguage("chat-en")).toBe("zh");
		expect(chatLanguage("zh")).toBe("zh");
		expect(chatLanguage("en")).toBe("en");
		expect(chatLanguage("chat-en")).toBe("en");
	});

	it("作用域外 useT 用 chrome 语言、LanguageScope 内用聊天语言（chat-en 档）", () => {
		const Probe = () => createElement("span", null, useT()("settings.language"));
		const outside = renderToStaticMarkup(createElement(Probe));
		const inside = renderToStaticMarkup(createElement(LanguageScope, null, createElement(Probe)));
		expect(outside).toContain(translate("zh", "settings.language"));
		expect(outside).not.toContain(translate("en", "settings.language"));
		expect(inside).toContain(translate("en", "settings.language"));
	});

	it("useScopedLanguage 与 useT 同一口径（域外 zh / 域内 en）", () => {
		const seen: Language[] = [];
		const Outside = () => {
			seen.push(useScopedLanguage());
			return null;
		};
		const Inside = () => {
			seen.push(useScopedLanguage());
			return null;
		};
		renderToStaticMarkup(createElement(Outside));
		renderToStaticMarkup(createElement(LanguageScope, null, createElement(Inside)));
		expect(seen).toEqual(["zh", "en"]);
	});

	it("语言上报：chrome 语种给 AI 起名（仅会话英文档报 zh，English 档才报 en），chat 语种给回复语种", () => {
		vi.stubGlobal("window", {});
		mocks.reported.length = 0;
		useI18nStore.getState().setLanguage("chat-en");
		expect(mocks.reported.at(-1)).toEqual({ language: "zh", chatLanguage: "en" });
		useI18nStore.getState().setLanguage("en");
		expect(mocks.reported.at(-1)).toEqual({ language: "en", chatLanguage: "en" });
		useI18nStore.getState().setLanguage("zh");
		expect(mocks.reported.at(-1)).toEqual({ language: "zh", chatLanguage: "zh" });
	});
});
