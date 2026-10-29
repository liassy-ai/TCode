import { afterEach, describe, expect, it, vi } from "vitest";

const realResourcesPath = process.resourcesPath;

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: vi.fn(() => true) };
});

function fakePackagedEnv() {
	Object.defineProperty(process, "resourcesPath", {
		value: "/fake/Tcode.app/Contents/Resources",
		configurable: true,
		writable: true,
	});
}

async function freshLoadEsbuild() {
	vi.resetModules();
	const mod = await import("./build");
	return mod.loadEsbuild();
}

afterEach(() => {
	if (realResourcesPath === undefined) delete (process as { resourcesPath?: string }).resourcesPath;
	else
		Object.defineProperty(process, "resourcesPath", {
			value: realResourcesPath,
			configurable: true,
			writable: true,
		});
	delete process.env.ESBUILD_BINARY_PATH;
});

describe("loadEsbuild env 现场恢复", () => {
	it("打包态二进制存在：求值后删除 env（原本未设置）", async () => {
		fakePackagedEnv();
		delete process.env.ESBUILD_BINARY_PATH;
		const esbuild = await freshLoadEsbuild();
		expect(typeof esbuild.build).toBe("function");
		expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined();
	});

	it("打包态二进制存在：求值后恢复用户预设值", async () => {
		fakePackagedEnv();
		process.env.ESBUILD_BINARY_PATH = "/user/own/esbuild";
		await freshLoadEsbuild();
		expect(process.env.ESBUILD_BINARY_PATH).toBe("/user/own/esbuild");
	});
});
