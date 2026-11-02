import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname);
const SOURCE_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

function listSources(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return listSources(path);
		return /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
	});
}

function edgesOf(file: string): string[] {
	const found = new Set<string>();
	for (const match of readFileSync(file, "utf8").matchAll(SOURCE_RE)) {
		const spec = match[1] ?? match[2];
		if (!spec?.startsWith(".")) continue;
		const base = resolve(dirname(file), spec);
		for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
			try {
				if (statSync(candidate).isFile()) found.add(candidate);
			} catch {}
		}
	}
	return [...found];
}

it("renderer 的 import 图无环（有环 = 模块体执行顺序不确定，模块级副作用会踩未初始化绑定）", () => {
	const sources = listSources(ROOT);
	const graph = new Map(sources.map((file) => [file, edgesOf(file)]));
	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];
	const cycles: string[] = [];

	function visit(node: string): void {
		state.set(node, "visiting");
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			if (!graph.has(next)) continue;
			if (state.get(next) === "visiting") {
				cycles.push([...stack.slice(stack.indexOf(next)), next].map((p) => relative(ROOT, p)).join(" → "));
				continue;
			}
			if (!state.has(next)) visit(next);
		}
		stack.pop();
		state.set(node, "done");
	}

	for (const file of sources) if (!state.has(file)) visit(file);
	expect(cycles).toEqual([]);
});

describe("本测试自己的守卫（防它自己失效）", () => {
	it("扫到的文件数与依赖解析都非空（否则「0 环」是假绿）", () => {
		const sources = listSources(ROOT);
		expect(sources.length).toBeGreaterThan(50);
		const withEdges = sources.filter((file) => edgesOf(file).length > 0);
		expect(withEdges.length).toBeGreaterThan(20);
	});
});
