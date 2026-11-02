import { describe, expect, it } from "vitest";
import { createLogger, formatTimestamp } from "../src/log";

const LOG_FILENAME_RE = /^main-\d{4}-\d{2}-\d{2}\.log$/;

function expectedOffset(d: Date): string {
	const offsetMin = d.getTimezoneOffset();
	const sign = offsetMin <= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

describe("formatTimestamp", () => {
	it("格式 = 本地时间 + ±HH:MM 偏移尾缀（契约正则）", () => {
		const ts = formatTimestamp(new Date());
		expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
	});

	it("各字段与 Date 本地 getter 一致（毫秒 3 位补零）", () => {
		const d = new Date(2026, 7, 27, 4, 39, 29, 29);
		const ts = formatTimestamp(d);
		expect(ts.startsWith("2026-08-27T04:39:29.029")).toBe(true);
	});

	it("偏移尾缀换算正确（getTimezoneOffset → ±HH:MM，含 UTC+0 边界）", () => {
		const d = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
		expect(formatTimestamp(d).endsWith(expectedOffset(d))).toBe(true);

		const zero = new Date();
		if (zero.getTimezoneOffset() === 0) {
			expect(formatTimestamp(zero).endsWith("+00:00")).toBe(true);
		}
	});

	it("文件名日期（本地）仍匹配 sweepOldLogs 的 main-<date>.log 正则", () => {
		const d = new Date(2026, 7, 27, 4, 39, 29, 29);
		const filename = `main-${formatTimestamp(d).slice(0, 10)}.log`;
		expect(filename).toBe("main-2026-08-27.log");
		expect(LOG_FILENAME_RE.test(filename)).toBe(true);
	});
});

describe("logger stdout 断管容错", () => {
	it("stdout 写入抛 EPIPE（管道对端消失）时不向上抛，不崩主进程", () => {
		const original = process.stdout.write;

		process.stdout.write = (() => {
			throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
		}) as typeof process.stdout.write;
		try {
			const log = createLogger("test");
			expect(() => log.error("断管下必须只丢日志，不抛异常")).not.toThrow();
		} finally {
			process.stdout.write = original;
		}
	});
});
