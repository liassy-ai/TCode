import type { PluginNotify } from "@tcode/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { usePluginNotifyStore } from "./plugin-notify";

const state = () => usePluginNotifyStore.getState();

describe("plugin-notify login_state", () => {
	beforeEach(() => {
		usePluginNotifyStore.setState({ loginEnabled: false, loginDisabled: false, qr: null });
	});

	it("关闭登录后，迟到的二维码通知不会重新打开登录入口", () => {
		state().apply({ kind: "login_state", enabled: false } as PluginNotify);
		expect(state().loginEnabled).toBe(false);
		expect(state().loginDisabled).toBe(true);

		state().apply({ kind: "qr", text: "二维码生成失败，稍后自动重试" } as PluginNotify);
		expect(state().loginEnabled).toBe(false);
		expect(state().qr).toBeNull();
	});

	it("重新打开登录后，二维码通知恢复正常", () => {
		state().apply({ kind: "login_state", enabled: false } as PluginNotify);
		state().apply({ kind: "login_state", enabled: true } as PluginNotify);
		expect(state().loginEnabled).toBe(true);
		expect(state().loginDisabled).toBe(false);

		state().apply({ kind: "qr", image: "data:image/png;base64,x", text: "请扫码" } as PluginNotify);
		expect(state().loginEnabled).toBe(true);
		expect(state().qr?.text).toBe("请扫码");
	});

	it("建码过程中的 pending 帧标记为等待，不把入口关掉", () => {
		state().apply({ kind: "login_state", enabled: true } as PluginNotify);
		state().apply({ kind: "qr", pending: true, text: "正在生成二维码…" } as PluginNotify);
		expect(state().qr?.pending).toBe(true);
		expect(state().qr?.image).toBeUndefined();
		state().apply({ kind: "qr", image: "data:image/png;base64,x", text: "请扫码" } as PluginNotify);
		expect(state().qr?.pending).toBe(false);
		expect(state().qr?.image).toBe("data:image/png;base64,x");
	});
});
