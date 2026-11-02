import { describe, expect, it } from "vitest";
import { syncEdgeFade } from "./use-edge-fade";

function fakeScroller(metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
	return { ...metrics, dataset: {} as DOMStringMap } as unknown as HTMLElement & {
		dataset: DOMStringMap & { fadeTop?: string; fadeBottom?: string };
	};
}

describe("syncEdgeFade — 滚动边界淡出的开关判定", () => {
	it("不溢出：不挂属性（没有「另一边」，边缘保持干净）", () => {
		const el = fakeScroller({ scrollHeight: 400, clientHeight: 400, scrollTop: 0 });
		syncEdgeFade(el);
		expect(el.dataset.fadeTop).toBeUndefined();
		expect(el.dataset.fadeBottom).toBeUndefined();
	});

	it("静止在顶部：只下沿淡出（顺带把「还能往下滚」变可见）", () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 0 });
		syncEdgeFade(el);
		expect(el.dataset.fadeTop).toBe("false");
		expect(el.dataset.fadeBottom).toBe("true");
	});

	it("滚到中部：两侧都淡出", () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 250 });
		syncEdgeFade(el);
		expect(el.dataset.fadeTop).toBe("true");
		expect(el.dataset.fadeBottom).toBe("true");
	});

	it("滚到底部：只上沿淡出", () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 500 });
		syncEdgeFade(el);
		expect(el.dataset.fadeTop).toBe("true");
		expect(el.dataset.fadeBottom).toBe("false");
	});

	it("分数 scrollTop（触控板/缩放）与 1px 残留都按「到头了」处理", () => {
		const near = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 0.5 });
		syncEdgeFade(near);
		expect(near.dataset.fadeTop).toBe("false");

		const almost = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 499.5 });
		syncEdgeFade(almost);
		expect(almost.dataset.fadeBottom).toBe("false");
	});

	it("从可滚到不可滚（内容变短）：清掉上一轮的旧属性", () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 250 });
		syncEdgeFade(el);
		el.dataset.fadeTop = "true";
		el.dataset.fadeBottom = "true";

		(el as unknown as { scrollHeight: number }).scrollHeight = 400;
		syncEdgeFade(el);
		expect(el.dataset.fadeTop).toBeUndefined();
		expect(el.dataset.fadeBottom).toBeUndefined();
	});

	it('edges="top"：只写上沿、不写下沿（对话区下沿贴输入框，那里不淡）', () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 250 });
		el.dataset.fadeBottom = "true";
		syncEdgeFade(el, "top");
		expect(el.dataset.fadeTop).toBe("true");
		expect(el.dataset.fadeBottom).toBeUndefined();

		(el as unknown as { scrollTop: number }).scrollTop = 0;
		syncEdgeFade(el, "top");
		expect(el.dataset.fadeTop).toBe("false");
		expect(el.dataset.fadeBottom).toBeUndefined();
	});

	it('edges="bottom"：只写下沿', () => {
		const el = fakeScroller({ scrollHeight: 900, clientHeight: 400, scrollTop: 250 });
		syncEdgeFade(el, "bottom");
		expect(el.dataset.fadeTop).toBeUndefined();
		expect(el.dataset.fadeBottom).toBe("true");
	});
});
