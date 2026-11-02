import { describe, expect, it } from "vitest";
import { parseMcpNotice } from "../src/mcp/notices";

describe("parseMcpNotice", () => {
	it("解析启动汇总里的需要授权与失败", () => {
		const text = [
			"MCP servers need attention:",
			"  docs: needs sign-in",
			"  probe: failed: spawn node ENOENT",
			"  config: something wrong",
			"Run /mcp to fix.",
		].join("\n");
		expect(parseMcpNotice(text)).toEqual({
			problems: [
				{ name: "docs", needsAuth: true, error: "needs sign-in" },
				{ name: "probe", error: "spawn node ENOENT" },
			],
			cleared: [],
		});
	});

	it("解析授权地址", () => {
		const text = 'Sign in to MCP server "docs" in your browser:\nhttps://example.com/authorize?x=1';
		expect(parseMcpNotice(text)).toEqual({
			problems: [{ name: "docs", needsAuth: true }],
			auth: { name: "docs", url: "https://example.com/authorize?x=1" },
			cleared: [],
		});
	});

	it("登录成功与重连成功都清掉状态", () => {
		expect(parseMcpNotice('Signed in to MCP server "docs" (3 tools).')).toEqual({
			problems: [],
			cleared: ["docs"],
		});
		expect(parseMcpNotice('Reconnected to MCP server "probe" (connected · 1 tool).')).toEqual({
			problems: [],
			cleared: ["probe"],
		});
	});

	it("加载失败给全局错误", () => {
		expect(parseMcpNotice("MCP failed to load: cannot find module")).toEqual({
			problems: [],
			cleared: [],
			globalError: "cannot find module",
		});
	});

	it("认不出来的文案不猜", () => {
		expect(
			parseMcpNotice("MCP servers are still connecting; their tools become available once connected."),
		).toBeUndefined();
		expect(parseMcpNotice("随便一句话")).toBeUndefined();
	});
});
