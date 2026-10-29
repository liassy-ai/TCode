import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceFile, resolveWorkspacePath } from "./fs-read";

let root: string;
const cleanups: string[] = [];

async function withTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "tcode-fs-read-"));
	cleanups.push(dir);
	return dir;
}

async function rmrf(dir: string): Promise<void> {
	try {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	} catch {}
}

beforeEach(async () => {
	root = await withTempDir();
	await mkdir(join(root, "sub"));
	await writeFile(join(root, "a.ts"), "hello\nworld\n");
	await writeFile(join(root, "sub", "b.ts"), "nested");
	await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 5]));
});

afterEach(async () => {
	root = "";
	for (const dir of cleanups.splice(0)) await rmrf(dir);
});

describe("resolveWorkspacePath 越界判定", () => {
	it("接受根内相对路径与绝对路径，统一返回真实绝对路径", async () => {
		const canonicalRoot = await realpath(root);
		const absolute = await resolveWorkspacePath(root, "a.ts");
		expect(absolute).toBe(join(canonicalRoot, "a.ts"));
		const viaAbsolute = await resolveWorkspacePath(root, join(root, "sub", "b.ts"));
		expect(viaAbsolute).toBe(join(canonicalRoot, "sub", "b.ts"));
	});

	it("拒绝 ../ 逃逸与根外绝对路径", async () => {
		await expect(resolveWorkspacePath(root, "../secret.txt")).rejects.toThrow();

		const outside = join(tmpdir(), "tcode-outside-marker.txt");
		await expect(resolveWorkspacePath(root, outside)).rejects.toThrow();
	});

	it("拒绝前导 .. 的伪装（root/../x）", async () => {
		await expect(resolveWorkspacePath(root, join("sub", "..", "..", "x"))).rejects.toThrow();
	});

	it("拒绝空路径与缺 cwd", async () => {
		await expect(resolveWorkspacePath("", "a.ts")).rejects.toThrow();
		await expect(resolveWorkspacePath(root, "")).rejects.toThrow();
		await expect(resolveWorkspacePath(root, "a\0b")).rejects.toThrow();
	});

	it("软链逃逸到根外被拦（建链失败则跳过）", async () => {
		const outside = await withTempDir();
		const link = join(root, "escape");
		try {
			await symlink(outside, link, "dir");
		} catch {
			return;
		}
		await expect(resolveWorkspacePath(root, "escape/secret.txt")).rejects.toThrow();
	});
});

describe("readWorkspaceFile 结果形态", () => {
	it("文本文件返回内容与相对路径", async () => {
		const result = await readWorkspaceFile({ cwd: root, path: "a.ts" });
		expect(result.content).toBe("hello\nworld\n");
		expect(result.path).toBe("a.ts");
		expect(result.binary).toBe(false);
		expect(result.truncated).toBe(false);
		expect(result.isDirectory).toBe(false);
	});

	it("目录返回 isDirectory 且无内容", async () => {
		const result = await readWorkspaceFile({ cwd: root, path: "sub" });
		expect(result.isDirectory).toBe(true);
		expect(result.content).toBeNull();
	});

	it("二进制（前导 NUL）返回 binary 且无内容", async () => {
		const result = await readWorkspaceFile({ cwd: root, path: "blob.bin" });
		expect(result.binary).toBe(true);
		expect(result.content).toBeNull();
	});

	it("maxBytes 截断并标记", async () => {
		const result = await readWorkspaceFile({ cwd: root, path: "a.ts", maxBytes: 7 });
		expect(result.truncated).toBe(true);
		expect(result.content).toBe("hello\nw");
	});

	it("maxBytes 超硬上限按硬上限执行", async () => {
		const result = await readWorkspaceFile({ cwd: root, path: "a.ts", maxBytes: 99_999_999 });

		expect(result.content).toBe("hello\nworld\n");
		expect(result.truncated).toBe(false);
	});

	it("越界读取直接抛（UI 显示原因，不落空结果）", async () => {
		await expect(readWorkspaceFile({ cwd: root, path: "../secret.txt" })).rejects.toThrow();
	});
});
