#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NL = String.fromCharCode(10);
const die = (m) => {
	process.stderr.write(m + NL);
	process.exit(1);
};

const componentDir = join(root, "packages", "desktop", "resources", "component");
const componentExe = join(componentDir, "component.exe");
const expected = (process.env.TCODE_COMPONENT_SHA256 ?? "").trim().toLowerCase();

if (!existsSync(componentExe) || !statSync(componentExe).isFile()) {
	die(
		[
			"[check-component] 缺少运行时组件：",
			"  packages/desktop/resources/component/component.exe",
			"",
			"该文件不在本仓库，由发布流程单独注入；源码构建无法产出可分发安装包，这是有意设计。",
			"",
			"拿不到组件时请只跑 `npm run dev` 或 `npm run build`。",
		].join(NL),
	);
}

if (!expected) {
	die(
		[
			"[check-component] 未设置 TCODE_COMPONENT_SHA256。",
			"",
			"打包时必须把组件哈希烘进主进程，否则宿主启动校验会判定组件损坏并退出：",
			"  $env:TCODE_COMPONENT_SHA256 = (Get-FileHash packages/desktop/resources/component/component.exe -Algorithm SHA256).Hash.ToLower()",
		].join(NL),
	);
}

const actual = createHash("sha256").update(readFileSync(componentExe)).digest("hex");
if (actual !== expected) {
	die(
		[
			"[check-component] TCODE_COMPONENT_SHA256 与实际组件不匹配。",
			`  期望：${expected}`,
			`  实际：${actual}`,
			"",
			"换过组件后必须重新设置哈希，再跑 npm run dist。",
		].join(NL),
	);
}

process.stdout.write(`[check-component] ok ${actual}${NL}`);
