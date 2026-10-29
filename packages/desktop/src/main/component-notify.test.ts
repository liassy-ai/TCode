import type { PluginNotify } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import { ComponentNotifyHost } from "./component-notify";

const login = (id: number, enabled: boolean): PluginNotify => ({ id, kind: "login_state", enabled });
const tunnel = (id: number): PluginNotify => ({ id, kind: "tunnel", state: "idle" });
const maint = (id: number, active: boolean): PluginNotify => ({ id, kind: "maintenance", active });

describe("ComponentNotifyHost 回放", () => {
	it("同一状态反复推送只回放最新一条", () => {
		const host = new ComponentNotifyHost();
		host.deliver(login(1, true));
		host.deliver(login(2, false));
		host.deliver(login(3, true));
		const replay = host.getReplay();
		expect(replay).toHaveLength(1);
		expect(replay[0]).toEqual(login(3, true));
	});

	it("不同状态各自回放，登录开关不会被后到的 tunnel 挤掉", () => {
		const host = new ComponentNotifyHost();
		host.deliver(login(1, true));
		host.deliver(tunnel(2));
		host.deliver(maint(3, false));
		const kinds = host.getReplay().map((n) => n.kind);
		expect(kinds).toContain("login_state");
		expect(kinds).toContain("tunnel");
		expect(kinds).toContain("maintenance");
	});

	it("最近更新的状态排在最后，回放顺序即新旧顺序", () => {
		const host = new ComponentNotifyHost();
		host.deliver(login(1, true));
		host.deliver(tunnel(2));
		host.deliver(login(3, false));
		expect(host.getReplay().map((n) => n.kind)).toEqual(["tunnel", "login_state"]);
	});

	it("事件类通知不回放（避免重放过期二维码或重复弹公告）", () => {
		const host = new ComponentNotifyHost();
		host.deliver({ id: 1, kind: "qr", image: "data:image/png;base64,xx" });
		host.deliver({ id: 2, kind: "announce", content: "公告" });
		host.deliver({ id: 3, kind: "status", text: "操作完成" });
		expect(host.getReplay()).toEqual([]);
	});

	it("事件类通知照样实时转发给界面", () => {
		const host = new ComponentNotifyHost();
		const seen: PluginNotify[] = [];
		host.setEmitter((n) => seen.push(n));
		host.deliver({ id: 1, kind: "announce", content: "公告" });
		expect(seen).toHaveLength(1);
	});

	it("防篡改遮挡占用独立槽位，不被组件维护状态覆盖", () => {
		const host = new ComponentNotifyHost();
		host.deliverGuard(maint(1, true));
		host.deliver(maint(2, false));
		const replay = host.getReplay();
		const maintFrames = replay.filter((n) => n.kind === "maintenance");
		expect(maintFrames).toHaveLength(2);
		expect(maintFrames[maintFrames.length - 1]).toEqual(maint(1, true));
	});

	it("stop 清空回放缓存", () => {
		const host = new ComponentNotifyHost();
		host.deliver(login(1, true));
		host.deliverGuard(maint(2, true));
		host.stop();
		expect(host.getReplay()).toEqual([]);
	});
});
