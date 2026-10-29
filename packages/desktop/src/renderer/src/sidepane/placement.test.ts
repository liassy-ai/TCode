import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
	getPi: () => ({ saveUiState: () => Promise.resolve(), loadUiState: () => Promise.resolve(null) }),
}));

import { SIDEPANE_MIN_WIDTH_PX } from "@tcode/shared";
import { SIDEBAR_WIDTH_PX } from "../lib/layout-metrics";
import { useChatLayoutStore } from "../stores/chat-layout";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { commitSidePaneWidth } from "./placement";
import { useSidePaneStore } from "./store";

function setViewport(widthPx: number): void {
	(globalThis as unknown as { window: { innerWidth: number } }).window = { innerWidth: widthPx };
}

const widthPx = () => useSidePaneStore.getState().widthPx;

beforeEach(() => {
	setViewport(1920);
	useSidePaneStore.setState({ widthPx: 420, chatWidthPx: null, owners: [], cwd: null, sessionId: null });
	useChatLayoutStore.setState({ floorPx: 0 });
	useUiPreferencesStore.setState({ sidebarCollapsed: false, autoCollapsed: false, sidebarFloating: false });
});

describe("commitSidePaneWidth", () => {
	it("撑到目标宽度，并按同一口径记住聊天列宽度", () => {
		const applied = commitSidePaneWidth(1100);
		expect(applied).toBe(1100);
		expect(widthPx()).toBe(1100);
		expect(useSidePaneStore.getState().chatWidthPx).toBe(1920 - SIDEBAR_WIDTH_PX - 1100);
	});

	it("目标超过视口 2/3 上限 → 停在上限，并如实回报实际落到的宽度", () => {
		expect(commitSidePaneWidth(1600)).toBe(1280);
		expect(widthPx()).toBe(1280);
	});

	it("不许把聊天列挤到地板以下：上限同时受聊天列地板约束", () => {
		useChatLayoutStore.setState({ floorPx: 500 });

		expect(commitSidePaneWidth(1600)).toBe(1180);
	});

	it("左栏收起/悬浮时不占布局宽，上限跟着放宽", () => {
		useChatLayoutStore.setState({ floorPx: 500 });
		useUiPreferencesStore.setState({ sidebarCollapsed: true });
		expect(commitSidePaneWidth(1600)).toBe(1280);
	});

	it("窄视口页面（375）→ 面板收到 375，两边不留死区", () => {
		expect(commitSidePaneWidth(375)).toBe(375);
		expect(widthPx()).toBe(375);
	});

	it("比最小宽还窄的目标 → 落到最小宽（面板自身还有可用下限）", () => {
		expect(commitSidePaneWidth(100)).toBe(SIDEPANE_MIN_WIDTH_PX);
	});

	it("窗口窄到连最小宽也放不下 → 不撑破，仍落到最小宽（该由仲裁决定收起）", () => {
		setViewport(600);
		useChatLayoutStore.setState({ floorPx: 400 });
		expect(commitSidePaneWidth(1280)).toBe(SIDEPANE_MIN_WIDTH_PX);
	});
});
