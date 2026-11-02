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
	die(["[check-component] 缺少文件：", "  packages/desktop/resources/component/component.exe"].join(NL));
}

if (!expected) {
	die("[check-component] 缺少环境变量 TCODE_COMPONENT_SHA256。");
}

const actual = createHash("sha256").update(readFileSync(componentExe)).digest("hex");
if (actual !== expected) {
	die("[check-component] 哈希不匹配。");
}

process.stdout.write(`[check-component] ok${NL}`);
