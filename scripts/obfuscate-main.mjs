import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "packages/desktop/out/main/index.js");

const code = readFileSync(file, "utf8");

const result = JavaScriptObfuscator.obfuscate(code, {
	compact: true,
	target: "node",
	sourceType: "module",
	identifierNamesGenerator: "hexadecimal",
	renameGlobals: false,
	stringArray: true,
	stringArrayEncoding: ["base64"],
	stringArrayThreshold: 1,
	stringArrayRotate: true,
	stringArrayWrappersCount: 2,
	splitStrings: true,
	splitStringsChunkLength: 8,
	controlFlowFlattening: false,
	deadCodeInjection: false,
	selfDefending: false,
	sourceMap: false,
});

writeFileSync(file, result.getObfuscatedCode(), "utf8");
process.stdout.write(`obfuscated main: ${result.getObfuscatedCode().length} bytes\n`);
