import { beforeEach, describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
	saveUiState: vi.fn((_payload: unknown) => Promise.resolve()),
	loadUiState: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { SIDEPANE_MAX_OWNERS, SIDEPANE_MIN_WIDTH_PX, SIDEPANE_WIDTH_HARD_MAX_PX } from "@tcode/shared";
import { NEW_SESSION_DRAFT_KEY } from "../stores/drafts";
import {
	isDockExpanded,
	isTabVisibleInSession,
	selectActiveTabId,
	selectOwnerTabs,
	useSidePaneStore,
} from "./store";

const ALPHA = "/work/alpha";
const BETA = "/work/beta";

function reset(): void {
	useSidePaneStore.setState({
		widthPx: 420,
		owners: [],
		cwd: null,
		sessionId: null,
		resizing: false,
	});
}

async function flushed(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

const store = () => useSidePaneStore.getState();

beforeEach(() => {
	reset();
	vi.clearAllMocks();
});

describe("sidepane store", () => {
	it("没有会话时不建 tab（侧栏内容全挂在会话上）", () => {
		const id = store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		expect(id).toBe("subagent-directory");
		expect(store().owners).toHaveLength(0);
	});

	it("singleton 类别重复打开只有一条 tab，且再次打开会抢焦点", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "code-viewer", discriminator: "a.ts", title: "a.ts" });
		const devToolsFirst = store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		store().openTab({ kind: "terminal", discriminator: "t1", title: "终端 1" });
		store().openTab({ kind: "subagent-directory", title: "开发者工具", activate: false });

		const tabs = selectOwnerTabs(store());
		expect(tabs.filter((tab) => tab.kind === "subagent-directory")).toHaveLength(1);

		expect(selectActiveTabId(store())).not.toBe(devToolsFirst);
	});

	it("多实例类别按 discriminator 分开", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "code-viewer", discriminator: "a.ts", title: "a.ts" });
		store().openTab({ kind: "code-viewer", discriminator: "b.ts", title: "b.ts" });
		expect(selectOwnerTabs(store()).map((tab) => tab.id)).toEqual(["code-viewer:a.ts", "code-viewer:b.ts"]);
	});

	it("tab 按会话窗口归属：切会话各看各的，切回来还在（关闭软件才清零）", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "terminal", discriminator: "c1", title: "终端 1", sessionId: "s1" });
		store().openTab({ kind: "subagent-directory", title: "开发者工具" });

		const tabs = selectOwnerTabs(store());
		const scoped = tabs.find((tab) => tab.kind === "terminal");
		const sessionScoped = tabs.find((tab) => tab.kind === "subagent-directory");
		expect(scoped && isTabVisibleInSession(scoped, "s1")).toBe(true);
		expect(scoped && isTabVisibleInSession(scoped, "s2")).toBe(false);
		expect(sessionScoped && isTabVisibleInSession(sessionScoped, "s2")).toBe(true);

		store().setOwner(ALPHA, "s2");
		expect(selectOwnerTabs(store())).toHaveLength(0);
		store().setOwner(ALPHA, "s1");
		expect(selectOwnerTabs(store())).toHaveLength(2);
	});

	it("关闭 tab 从列表移除（不再记录最近关闭）", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "terminal", discriminator: "t1", title: "终端 1" });
		store().closeTab("terminal:t1");
		expect(selectOwnerTabs(store())).toHaveLength(0);
	});

	it("关闭激活 tab 回退到相邻（优先右邻、其次左邻），关最后一个才置空", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "code-viewer", discriminator: "a", title: "a" });
		store().openTab({ kind: "code-viewer", discriminator: "b", title: "b" });
		store().openTab({ kind: "code-viewer", discriminator: "c", title: "c" });
		store().activateTab("code-viewer:b");
		store().closeTab("code-viewer:b");

		expect(selectActiveTabId(store())).toBe("code-viewer:c");
		store().activateTab("code-viewer:c");
		store().closeTab("code-viewer:c");
		expect(selectActiveTabId(store())).toBe("code-viewer:a");
		store().closeTab("code-viewer:a");
		expect(selectActiveTabId(store())).toBeNull();

		store().openTab({ kind: "code-viewer", discriminator: "x", title: "x" });
		store().openTab({ kind: "code-viewer", discriminator: "y", title: "y" });
		store().closeTab("code-viewer:x");
		expect(selectActiveTabId(store())).toBe("code-viewer:y");
	});

	it("重排按目标位置落点，未知 id 不动结构", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "code-viewer", discriminator: "a", title: "a" });
		store().openTab({ kind: "code-viewer", discriminator: "b", title: "b" });
		store().openTab({ kind: "code-viewer", discriminator: "c", title: "c" });
		store().reorderTabs("code-viewer:a", "code-viewer:c");
		expect(selectOwnerTabs(store()).map((tab) => tab.id)).toEqual([
			"code-viewer:b",
			"code-viewer:c",
			"code-viewer:a",
		]);
		store().reorderTabs("code-viewer:a", "nope");
		expect(selectOwnerTabs(store())).toHaveLength(3);
	});

	it("ensureOwner：只补记录、不改「当前会话」身份（AI 后台会话不抢归属）", () => {
		store().setOwner(ALPHA, "sess-a");
		store().ensureOwner(BETA, "sess-b");

		expect(store().sessionId).toBe("sess-a");
		expect(store().owners.some((o) => o.sessionId === "sess-b")).toBe(true);

		store().ensureOwner(BETA, "sess-a");
		expect(store().owners.filter((o) => o.sessionId === "sess-a")).toHaveLength(1);
	});

	it("宽度夹在可读区间并只写回宽度（面板记忆不落盘）", async () => {
		store().setOwner(ALPHA, "s1");

		expect(isDockExpanded(store())).toBe(false);
		store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		expect(isDockExpanded(store())).toBe(true);

		store().setOwner(BETA, "s2");
		await flushed();
		expect(piMock.saveUiState).not.toHaveBeenCalled();

		store().commitWidth(10_000);
		expect(store().widthPx).toBe(SIDEPANE_WIDTH_HARD_MAX_PX);
		store().commitWidth(1);
		expect(store().widthPx).toBe(SIDEPANE_MIN_WIDTH_PX);
		await flushed();
		const payload = piMock.saveUiState.mock.calls.at(-1)?.[0] as {
			state: { sidePane: { widthPx: number; expandedCwd: string | null; owners: unknown[] } };
		};
		expect(payload.state.sidePane.widthPx).toBe(SIDEPANE_MIN_WIDTH_PX);

		expect(payload.state.sidePane.expandedCwd).toBeNull();
		expect(payload.state.sidePane.owners).toEqual([]);
	});

	it("拖拽中的 previewWidth 不落盘，松手才落（避免每帧写文件）", async () => {
		store().setOwner(ALPHA, "s1");
		await flushed();
		vi.clearAllMocks();
		store().previewWidth(500);
		expect(store().widthPx).toBe(500);
		await flushed();
		expect(piMock.saveUiState).not.toHaveBeenCalled();
		store().commitWidth(500);
		await flushed();
		expect(piMock.saveUiState).toHaveBeenCalledTimes(1);
	});

	it("hydrate 只恢复宽度：面板记忆关闭软件即清零", () => {
		useSidePaneStore.getState().hydrate({
			widthPx: 500,
			expandedCwd: ALPHA,
			owners: [
				{
					cwd: ALPHA,
					activeTabId: "terminal:t1",
					tabs: [{ id: "terminal:t1", kind: "terminal", title: "终端 1", payload: {}, openedAt: 1 }],
				},
			],
		});
		expect(store().widthPx).toBe(500);

		expect(store().owners).toHaveLength(0);
		expect(selectActiveTabId(store())).toBeNull();
		expect(isDockExpanded(store())).toBe(false);
	});

	it("owner 按会话最近使用前移，并按上限截断", () => {
		store().setOwner(ALPHA, "s1");
		store().setOwner(BETA, "s2");
		expect(store().owners.map((owner) => owner.sessionId)).toEqual(["s1", "s2"]);
		store().setOwner(ALPHA, "s1");
		expect(store().owners.map((owner) => owner.sessionId)).toEqual(["s2", "s1"]);

		const many = Array.from({ length: SIDEPANE_MAX_OWNERS + 5 }, (_, index) => `/w/${index}`);
		for (const cwd of many) store().setOwner(cwd, cwd);
		expect(store().owners).toHaveLength(SIDEPANE_MAX_OWNERS);
		expect(store().owners.at(-1)?.sessionId).toBe(many.at(-1));
		expect(store().owners.some((owner) => owner.sessionId === many[0])).toBe(false);
	});

	it("展开态按会话窗口记忆：切会话各记各的，关合不丢 tab", () => {
		store().setOwner(ALPHA, "s1");
		store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		expect(isDockExpanded(store())).toBe(true);

		store().setOwner(BETA, "s2");
		expect(isDockExpanded(store())).toBe(false);

		store().setOwner(ALPHA, "s1");
		expect(isDockExpanded(store())).toBe(true);
		store().toggleExpanded();
		expect(isDockExpanded(store())).toBe(false);
		expect(selectOwnerTabs(store())).toHaveLength(1);
	});

	it("新会话页（draft）也占一个窗口位：能开合、能开面板", () => {
		store().setOwner(ALPHA, NEW_SESSION_DRAFT_KEY);
		expect(isDockExpanded(store())).toBe(false);
		store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		expect(isDockExpanded(store())).toBe(true);
		expect(selectOwnerTabs(store())).toHaveLength(1);
	});

	it("draft 转正：面板过继给真实会话，草稿位清零（下一张新会话页从零开始）", () => {
		store().setOwner(ALPHA, NEW_SESSION_DRAFT_KEY);
		store().openTab({ kind: "subagent-directory", title: "开发者工具" });
		store().adoptDraftOwner(NEW_SESSION_DRAFT_KEY, "s1");

		expect(store().owners.map((owner) => owner.sessionId)).toEqual(["s1"]);
		expect(store().owners[0]?.expanded).toBe(true);
		expect(store().owners[0]?.tabs).toHaveLength(1);

		store().setOwner(ALPHA, NEW_SESSION_DRAFT_KEY);
		expect(isDockExpanded(store())).toBe(false);
		expect(selectOwnerTabs(store())).toHaveLength(0);
	});
});
