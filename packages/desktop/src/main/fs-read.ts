import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FileReadRequest, FileReadResult } from "@tcode/shared";
import { FS_READ_DEFAULT_MAX_BYTES, FS_READ_HARD_MAX_BYTES } from "@tcode/shared";

const BINARY_SNIFF_BYTES = 8192;

const MAX_ANCESTOR_HOPS = 64;

const REPLACEMENT_CHAR = "\uFFFD";

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	if (rel === "") return true;
	if (isAbsolute(rel)) return false;
	return rel !== ".." && !rel.startsWith(`..${sep}`);
}

async function realpathExisting(target: string): Promise<string> {
	const tail: string[] = [];
	let cursor = target;
	for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
		try {
			const real = await realpath(cursor);
			return tail.length > 0 ? resolve(real, ...tail) : real;
		} catch {
			const parent = dirname(cursor);
			if (parent === cursor) return target;
			tail.unshift(relative(parent, cursor));
			cursor = parent;
		}
	}
	return target;
}

export async function resolveWorkspaceRoot(cwd: string): Promise<string> {
	if (typeof cwd !== "string" || cwd.trim() === "") throw new Error("缺少项目目录");
	return realpathExisting(resolve(cwd));
}

export async function resolveWorkspacePath(cwd: string, target: string): Promise<string> {
	if (typeof target !== "string" || target.trim() === "") throw new Error("缺少文件路径");
	if (target.includes("\0")) throw new Error("非法路径");

	const root = await resolveWorkspaceRoot(cwd);
	const absolute = resolve(root, target);

	if (isAbsolute(relative(root, absolute))) throw new Error("路径越出项目范围");
	const real = await realpathExisting(absolute);
	if (!isInside(root, real)) throw new Error("路径越出项目范围（软链/短名归一后仍在界外）");
	return real;
}

export function toProjectRelative(root: string, absolute: string): string {
	const rel = relative(root, absolute);
	return rel === "" ? "" : rel.split(sep).join("/");
}

function looksBinary(buffer: Buffer): boolean {
	const span = Math.min(buffer.length, BINARY_SNIFF_BYTES);
	for (let index = 0; index < span; index += 1) {
		if (buffer[index] === 0) return true;
	}
	return false;
}

function countInvalidUtf8(text: string): number {
	let count = 0;
	for (const char of text) if (char === REPLACEMENT_CHAR) count += 1;
	return count;
}

export async function readWorkspaceFile(request: FileReadRequest): Promise<FileReadResult> {
	const root = await resolveWorkspaceRoot(request.cwd);
	const absolute = await resolveWorkspacePath(request.cwd, request.path);
	const cap = Math.min(
		typeof request.maxBytes === "number" && request.maxBytes > 0
			? Math.floor(request.maxBytes)
			: FS_READ_DEFAULT_MAX_BYTES,
		FS_READ_HARD_MAX_BYTES,
	);

	const info = await stat(absolute);
	const base = { path: toProjectRelative(root, absolute), size: info.size, isDirectory: info.isDirectory() };
	if (base.isDirectory) {
		return { ...base, content: null, truncated: false, binary: false, invalidUtf8: 0 };
	}

	const buffer = await readFile(absolute);
	if (looksBinary(buffer)) {
		return { ...base, content: null, truncated: buffer.length > cap, binary: true, invalidUtf8: 0 };
	}
	const truncated = buffer.length > cap;
	const text = (truncated ? buffer.subarray(0, cap) : buffer).toString("utf8");
	return { ...base, content: text, truncated, binary: false, invalidUtf8: countInvalidUtf8(text) };
}
