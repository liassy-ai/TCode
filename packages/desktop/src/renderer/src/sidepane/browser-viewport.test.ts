import { DEFAULT_WINDOW_PRESET } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import {
	autoZoomFor,
	clampZoom,
	DEFAULT_ZOOM_VALUES,
	DESKTOP_SIZE,
	frameChoiceFor,
	frameSizeFor,
	isAutoFrame,
	isDesktopFrame,
	pageZoomFor,
	useBrowserViewportStore,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_STEP,
	zoomValueFor,
	zoomValuesOf,
} from "./browser-viewport";

const VALUES = (auto: number, desktop: number) => ({ auto, desktop });

describe("装得下：autoZoomFor", () => {
	it("装不下就等比缩到装得下（1280 的容器在 466 宽的面板里 → 36%）", () => {
		expect(autoZoomFor(466, 700, 1280, 800)).toBeCloseTo(0.364, 3);
	});

	it("高度也会限制缩放（宽够高不够时按高缩）", () => {
		expect(autoZoomFor(2000, 400, 1000, 800)).toBe(0.5);
	});

	it("装得下就不放大（窄容器 1:1 显示，多余空间留在框外由面板居中）", () => {
		expect(autoZoomFor(466, 900, 375, 800)).toBe(1);
	});

	it("容器或尺寸还没量到（0）→ 不缩，宁可 1:1", () => {
		expect(autoZoomFor(0, 0, 1280, 800)).toBe(1);
		expect(autoZoomFor(466, 700, 0, 0)).toBe(1);
	});

	it("有地板（5%）：极端长页面也不会缩到看不见", () => {
		expect(autoZoomFor(466, 700, 100000, 100000)).toBe(0.05);
	});

	it("与页面缩放无关：容器尺寸定了，比例就定了（倍数改的是容器里面的排版宽度）", () => {
		const panel = { width: 466, height: 700 };
		expect(autoZoomFor(panel.width, panel.height, panel.width, panel.height)).toBe(1);

		expect(autoZoomFor(466, 700, 1280, 800)).toBeCloseTo(0.364, 3);
	});
});

describe("页面缩放：范围与夹紧", () => {
	it("范围是 25%–400%（Chromium 实际只认到 25%–500%，留出余量）", () => {
		expect(ZOOM_MIN).toBe(0.25);
		expect(ZOOM_MAX).toBe(4);
		expect(ZOOM_STEP).toBe(0.1);
	});

	it("越界值夹进区间；非有限数按 100%（输入框里打出 Infinity 这种也走这条路）", () => {
		expect(clampZoom(1.5)).toBe(1.5);
		expect(clampZoom(10)).toBe(4);
		expect(clampZoom(0.05)).toBe(0.25);
		expect(clampZoom(Number.NaN)).toBe(1);
		expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("页面缩放：下发到 guest 的值", () => {
	it("可调节窗口模式：取当前档自己那一份（两档各存一个值）", () => {
		const values = VALUES(1.5, 2);
		expect(pageZoomFor("manual", "auto", values)).toBe(1.5);
		expect(pageZoomFor("manual", "desktop", values)).toBe(2);
	});

	it("默认值：自适应档 80%、桌面版档 100%（两档不再相同）", () => {
		expect(DEFAULT_ZOOM_VALUES).toEqual({ auto: 0.8, desktop: 1 });
		expect(pageZoomFor("manual", "auto", DEFAULT_ZOOM_VALUES)).toBe(0.8);
		expect(pageZoomFor("manual", "desktop", DEFAULT_ZOOM_VALUES)).toBe(1);
	});

	it("自适应档的默认 80% 就是页面缩放 0.8：布局视口比容器宽 25%（面板 400 → 500）", () => {
		const panel = { width: 400, height: 300 };
		const frame = frameSizeFor(undefined, "auto", panel);
		const zoom = pageZoomFor("manual", "auto", DEFAULT_ZOOM_VALUES);
		expect(frame).toEqual(panel);
		expect(zoom).toBe(0.8);
		expect(Math.round(frame.width / zoom)).toBe(500);
	});

	it("自适应窗口模式：一律 1（关掉窗口调整 = 什么都没调，偏好留着不生效）", () => {
		const values = VALUES(1.5, 2);
		expect(pageZoomFor("fit", "auto", values)).toBe(1);
		expect(pageZoomFor("fit", "desktop", values)).toBe(1);
	});

	it("存进去的值也会被夹紧（越界不让它到 guest 那层）", () => {
		expect(clampZoom(10)).toBe(ZOOM_MAX);
	});

	it("视口条显示用的值：自适应模式下显示的是自适应档那一份", () => {
		const values = VALUES(1.5, 2);
		expect(zoomValueFor("manual", "desktop", values)).toBe(2);
		expect(zoomValueFor("fit", "auto", values)).toBe(1.5);
	});
});

describe("容器尺寸：看容器档", () => {
	const panel = { width: 452, height: 408 };

	it("自适应档：容器以侧边栏大小自动调整（面板多宽页面就按多宽排版）", () => {
		expect(frameSizeFor(undefined, "auto", panel)).toEqual({ width: 452, height: 408 });
	});

	it("只有桌面版档按窗口尺寸排版：自适应档不看尺寸（覆盖留着，切到桌面版还在）", () => {
		const override = { width: 1600, height: 900 };
		expect(frameSizeFor(override, "auto", panel)).toEqual({ width: 452, height: 408 });
		expect(frameSizeFor(override, "desktop", panel)).toEqual({ width: 1600, height: 900 });
	});

	it("桌面版档：没设过尺寸时默认 1280×800", () => {
		expect(frameSizeFor(undefined, "desktop", panel)).toEqual({ width: 1280, height: 800 });
		expect(DESKTOP_SIZE).toEqual({ width: 1280, height: 800 });
	});

	it("桌面版档的默认就是 shared 表里的桌面版预设（两边同一个数）", () => {
		expect(DESKTOP_SIZE).toEqual({
			width: DEFAULT_WINDOW_PRESET.width,
			height: DEFAULT_WINDOW_PRESET.height,
		});
		expect(DEFAULT_WINDOW_PRESET.id).toBe("desktop");
	});

	it("桌面版档的显示尺寸正好装进面板，不会比侧边栏宽", () => {
		const frame = frameSizeFor(undefined, "desktop", panel);
		const scale = autoZoomFor(panel.width, panel.height, frame.width, frame.height);
		expect(frame).toEqual({ width: 1280, height: 800 });
		expect(scale).toBeCloseTo(0.353, 3);
		expect(Math.round(frame.width * scale)).toBeLessThanOrEqual(panel.width);
	});

	it("frameChoiceFor：自适应窗口模式一律按自适应档算；可调节窗口看用户选的", () => {
		expect(frameChoiceFor("fit", "auto")).toBe("auto");
		expect(frameChoiceFor("fit", "desktop")).toBe("auto");
		expect(frameChoiceFor("manual", "auto")).toBe("auto");
		expect(frameChoiceFor("manual", "desktop")).toBe("desktop");
	});

	it("isAutoFrame / isDesktopFrame：两档互斥，自适应窗口模式下恒为自适应", () => {
		expect(isAutoFrame("fit", "desktop")).toBe(true);
		expect(isDesktopFrame("fit", "desktop")).toBe(false);
		expect(isAutoFrame("manual", "auto")).toBe(true);
		expect(isDesktopFrame("manual", "desktop")).toBe(true);
	});
});

describe("store：容器档与两档缩放各记各的", () => {
	it("容器档按 tab 记，默认自适应", () => {
		expect(useBrowserViewportStore.getState().frames.f1 ?? "auto").toBe("auto");
		useBrowserViewportStore.getState().setFrame("f1", "desktop");
		expect(useBrowserViewportStore.getState().frames.f1).toBe("desktop");
		expect(useBrowserViewportStore.getState().frames.f2).toBeUndefined();
	});

	it("缩放按 tab、按档记：改自适应档不动桌面版档，反之亦然", () => {
		const store = useBrowserViewportStore.getState();
		store.setZoomValue("z1", "auto", 1.5);
		expect(zoomValuesOf("z1")).toEqual({ auto: 1.5, desktop: 1 });
		store.setZoomValue("z1", "desktop", 0.5);
		expect(zoomValuesOf("z1")).toEqual({ auto: 1.5, desktop: 0.5 });

		expect(zoomValuesOf("z2")).toEqual(DEFAULT_ZOOM_VALUES);
	});

	it("存进来的缩放值当场夹紧（越界不让它进 store）", () => {
		useBrowserViewportStore.getState().setZoomValue("z3", "auto", 10);
		expect(zoomValuesOf("z3").auto).toBe(ZOOM_MAX);
		useBrowserViewportStore.getState().setZoomValue("z3", "desktop", 0.01);
		expect(zoomValuesOf("z3").desktop).toBe(ZOOM_MIN);
	});

	it("切模式不丢覆盖、也不丢两档的缩放（切回来还在）", () => {
		const store = useBrowserViewportStore.getState();
		store.setOverride("m3", { width: 1280, height: 800, source: "ai" });
		store.setZoomValue("m3", "desktop", 1.5);
		store.setMode("m3", "manual");
		store.setMode("m3", "fit");
		const now = useBrowserViewportStore.getState();
		expect(now.overrides.m3).toMatchObject({ width: 1280, height: 800 });
		expect(now.zoomValues.m3?.desktop).toBe(1.5);
		expect(now.modes.m3).toBe("fit");
	});

	it("撤销尺寸不动缩放（缩放是用户的视图偏好，不该被撤销掉）", () => {
		const store = useBrowserViewportStore.getState();
		store.setOverride("t1", { width: 1280, height: 800, source: "ai" });
		store.setZoomValue("t1", "desktop", 0.5);
		store.clearOverride("t1");
		expect(useBrowserViewportStore.getState().overrides.t1).toBeUndefined();
		expect(zoomValuesOf("t1").desktop).toBe(0.5);
	});
});

describe("两种模式：自适应窗口 / 可调节窗口", () => {
	const panel = { width: 466, height: 700 };

	it("自适应档：容器就是面板大小（显示比例因此正好 1）", () => {
		const frame = frameSizeFor(undefined, "auto", panel);
		expect(frame).toEqual({ width: panel.width, height: panel.height });
		expect(autoZoomFor(panel.width, panel.height, frame.width, frame.height)).toBe(1);
	});

	it("桌面版档：容器按 1280×800 排版，显示缩到装得下", () => {
		const frame = frameSizeFor(undefined, "desktop", panel);
		const scale = autoZoomFor(panel.width, panel.height, frame.width, frame.height);
		expect(frame).toEqual({ width: 1280, height: 800 });
		expect(Math.round(frame.width * scale)).toBeLessThanOrEqual(panel.width);
	});

	it("桌面版档的容器尺寸不看缩放：150% 只是页面重排，容器仍是 1280×800", () => {
		const values = VALUES(1, 1.5);
		const frame = frameSizeFor(undefined, "desktop", panel);
		expect(frame).toEqual({ width: 1280, height: 800 });
		expect(pageZoomFor("manual", "desktop", values)).toBe(1.5);

		expect(Math.round(frame.width / pageZoomFor("manual", "desktop", values))).toBe(853);
	});
});
