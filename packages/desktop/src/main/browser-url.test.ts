import { isAllowedBrowserUrl, normalizeBrowserUrl } from "@tcode/shared";
import { describe, expect, it } from "vitest";

describe("normalizeBrowserUrl", () => {
	it("无协议的输入默认补 https://", () => {
		expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
		expect(normalizeBrowserUrl("  example.com/path  ")).toBe("https://example.com/path");
	});

	it("本地明文形态默认补 http://（IP 字面量 / localhost / 显式端口）", () => {
		expect(normalizeBrowserUrl("127.0.0.1:1000")).toBe("http://127.0.0.1:1000");
		expect(normalizeBrowserUrl("127.0.0.1")).toBe("http://127.0.0.1");
		expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000");
		expect(normalizeBrowserUrl("LOCALHOST")).toBe("http://LOCALHOST");

		expect(normalizeBrowserUrl("example.com:8080")).toBe("http://example.com:8080");
	});

	it("带协议的输入原样保留", () => {
		expect(normalizeBrowserUrl("http://a.b")).toBe("http://a.b");
		expect(normalizeBrowserUrl("https://a.b/x?y=1")).toBe("https://a.b/x?y=1");
		expect(normalizeBrowserUrl("http://127.0.0.1:1000/")).toBe("http://127.0.0.1:1000/");
	});

	it("空输入回 about:blank", () => {
		expect(normalizeBrowserUrl("")).toBe("about:blank");
		expect(normalizeBrowserUrl("   ")).toBe("about:blank");
	});
});

describe("isAllowedBrowserUrl", () => {
	it("放行 http/https/about/file", () => {
		expect(isAllowedBrowserUrl("https://example.com")).toBe(true);
		expect(isAllowedBrowserUrl("http://example.com")).toBe(true);
		expect(isAllowedBrowserUrl("about:blank")).toBe(true);
		expect(isAllowedBrowserUrl("file:///E:/test/browser-os.html")).toBe(true);
	});

	it("拒绝 js/data/chrome 等其余协议", () => {
		expect(isAllowedBrowserUrl("javascript:alert(1)")).toBe(false);
		expect(isAllowedBrowserUrl("data:text/html,<b>x</b>")).toBe(false);
		expect(isAllowedBrowserUrl("chrome://settings")).toBe(false);
	});
});
