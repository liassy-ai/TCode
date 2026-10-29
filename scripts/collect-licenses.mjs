import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NL = String.fromCharCode(10);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = root + "/packages/desktop/resources/licenses";
const outFile = outDir + "/THIRD-PARTY-LICENSES.txt";

function isLicenseFileName(name) {
	const lower = name.toLowerCase();
	const base = lower.split(".")[0];
	return base === "license" || base === "licence" || base === "copying" || base === "notice";
}

function readIf(path) {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

const found = new Map();

function collectPackage(dir, label) {
	const pj = dir + "/package.json";
	if (!existsSync(pj)) return false;
	let meta = {};
	try {
		meta = JSON.parse(readFileSync(pj, "utf8"));
	} catch {
		return false;
	}
	const name = typeof meta.name === "string" && meta.name ? meta.name : label;
	if (found.has(name)) return true;
	let fileNames = [];
	try {
		fileNames = readdirSync(dir).filter(isLicenseFileName);
	} catch {
		fileNames = [];
	}
	const declared =
		typeof meta.license === "string" ? meta.license : (meta.license && meta.license.type) || "UNKNOWN";
	found.set(name, {
		name,
		version: typeof meta.version === "string" ? meta.version : "",
		declared: String(declared),
		files: fileNames.map((f) => dir + "/" + f),
	});
	return true;
}

const nm = root + "/node_modules";
for (const entry of readdirSync(nm, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	if (entry.name.charAt(0) === ".") continue;
	if (entry.name === ".bin" || entry.name === ".cache") continue;
	if (entry.name.charAt(0) === "@") {
		for (const sub of readdirSync(nm + "/" + entry.name, { withFileTypes: true })) {
			if (!sub.isDirectory()) continue;
			collectPackage(nm + "/" + entry.name + "/" + sub.name, entry.name + "/" + sub.name);
		}
		continue;
	}
	collectPackage(nm + "/" + entry.name, entry.name);
}

const lines = [];
lines.push("TCode — 许可信息与第三方许可全文");
lines.push("=".repeat(80));
lines.push("");
lines.push("本文件由 scripts/collect-licenses.mjs 生成，随安装包一起分发。");
lines.push("共收录 " + found.size + " 个随包分发的第三方组件。");
lines.push("每个组件均保留其原始许可与著作权。");
lines.push("");
lines.push("=".repeat(80));
lines.push("TCode（Apache-2.0）与其所基于的 Percho（MIT）");
lines.push("=".repeat(80));
lines.push("");
lines.push(readIf(root + "/LICENSE"));
lines.push("");
lines.push("-".repeat(80));
lines.push("来源署名 / Attribution");
lines.push("-".repeat(80));
lines.push("");
lines.push(readIf(root + "/NOTICE"));
lines.push("");
lines.push("=".repeat(80));
lines.push("内置版本控制与 Shell");
lines.push("=".repeat(80));
lines.push("");
lines.push("版本控制与命令执行随运行时组件一同分发（编译进 component），与 TCode 本体同以 Apache-2.0 许可。");
lines.push("");
lines.push("=".repeat(80));
lines.push("第三方组件（按名称排序，共 " + found.size + " 个）");
lines.push("=".repeat(80));
lines.push("");
const names = [...found.keys()].sort((a, b) => a.localeCompare(b));
for (const name of names) {
	const item = found.get(name);
	lines.push("-".repeat(80));
	lines.push(item.name + (item.version ? " " + item.version : ""));
	lines.push("License: " + item.declared);
	lines.push("-".repeat(80));
	if (item.files.length === 0) {
		lines.push("（该包未随包提供许可文件，协议以上方 package.json 声明的 license 字段为准）");
	} else {
		for (const f of item.files) {
			lines.push(readIf(f));
			lines.push("");
		}
	}
	lines.push("");
}
mkdirSync(outDir, { recursive: true });
const text = lines.join(NL);
writeFileSync(outFile, text);

writeFileSync(outDir + "/LICENSE.txt", readIf(root + "/LICENSE") + NL);
writeFileSync(outDir + "/NOTICE.txt", readIf(root + "/NOTICE") + NL);
process.stdout.write("已生成 " + outFile + NL);
process.stdout.write("组件数 " + found.size + "，文件大小 " + Math.round(text.length / 1024) + " KB" + NL);
