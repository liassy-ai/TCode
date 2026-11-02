import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	McpConfigListResult,
	McpExposure,
	McpServerView,
	McpTransportView,
	McpUpsertInput,
} from "@tcode/shared";
import { createLogger } from "../log";

const log = createLogger("mcp");

const DEFAULT_EXPOSURE: McpExposure = "codemode";

interface RawServerEntry {
	type?: string;
	command?: string;
	args?: unknown;
	env?: unknown;
	cwd?: string;
	url?: string;
	headers?: unknown;
	description?: string;
	enabled?: boolean;
	exposure?: string;
	toolExposure?: unknown;
	timeout?: number;
}

interface RawFile {
	mcpServers?: Record<string, RawServerEntry>;
	[key: string]: unknown;
}

export function globalMcpPath(): string {
	return join(getAgentDir(), "mcp.json");
}

export function projectMcpPath(cwd: string): string {
	return join(cwd, ".pi", "mcp.json");
}

function readFile(path: string): { raw: RawFile; errors: string[] } {
	if (!existsSync(path)) return { raw: {}, errors: [] };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { raw: {}, errors: [`${path}：顶层不是对象`] };
		}
		return { raw: parsed as RawFile, errors: [] };
	} catch (error) {
		return { raw: {}, errors: [`${path}：${error instanceof Error ? error.message : String(error)}`] };
	}
}

function strings(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const list = value.filter((item): item is string => typeof item === "string");
	return list.length > 0 ? list : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const entries = Object.entries(value as Record<string, unknown>).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function exposureOf(value: unknown): Record<string, McpExposure> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out: Record<string, McpExposure> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (raw === "direct" || raw === "deferred" || raw === "codemode" || raw === "hidden") out[key] = raw;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeExposure(value: unknown): McpExposure | undefined {
	return value === "direct" || value === "deferred" || value === "codemode" || value === "hidden"
		? value
		: undefined;
}

function hasConnectionInfo(entry: RawServerEntry): boolean {
	return typeof entry.command === "string" || typeof entry.url === "string";
}

function transportOf(entry: RawServerEntry): McpTransportView {
	if (typeof entry.url === "string") return { kind: "url", url: entry.url };
	if (typeof entry.command === "string") {
		return { kind: "stdio", command: entry.command, args: strings(entry.args) };
	}
	return { kind: "unknown" };
}

function toView(name: string, entry: RawServerEntry, scope: "user" | "project"): McpServerView {
	const exposureRaw = normalizeExposure(entry.exposure);
	return {
		name,
		scope,
		transport: transportOf(entry),
		description: entry.description,
		enabled: entry.enabled !== false,
		exposureRaw,
		exposure: exposureRaw ?? DEFAULT_EXPOSURE,
		toolExposure: exposureOf(entry.toolExposure),
		headers: stringMap(entry.headers),
		overrideOnly: hasConnectionInfo(entry) ? undefined : true,
		tools: [],
	};
}

export function readMcpConfig(
	cwd: string | undefined,
	projectTrusted: boolean,
	runtime: Map<
		string,
		{ tools: McpServerView["tools"]; error?: string; needsAuth?: boolean; authUrl?: string }
	> = new Map(),
): McpConfigListResult {
	const globalPath = globalMcpPath();
	const projectPath = cwd ? projectMcpPath(cwd) : undefined;
	const global = readFile(globalPath);
	const project = projectPath && projectTrusted ? readFile(projectPath) : { raw: {}, errors: [] };

	const globals = new Map<string, McpServerView>();
	for (const [name, entry] of Object.entries(global.raw.mcpServers ?? {})) {
		globals.set(name, toView(name, entry, "user"));
	}

	const projects = new Map<string, McpServerView>();
	for (const [name, entry] of Object.entries(project.raw.mcpServers ?? {})) {
		const base = globals.get(name);
		if (base && !hasConnectionInfo(entry)) {
			const exposureRaw = normalizeExposure(entry.exposure) ?? base.exposureRaw;
			projects.set(name, {
				...base,
				scope: "project",
				enabled: entry.enabled !== false,
				exposureRaw,
				exposure: exposureRaw ?? DEFAULT_EXPOSURE,
				toolExposure: exposureOf(entry.toolExposure) ?? base.toolExposure,
				overrideOnly: true,
			});
			continue;
		}
		projects.set(name, toView(name, entry, "project"));
	}

	for (const server of [...globals.values(), ...projects.values()]) {
		const live = runtime.get(server.name);
		if (!live) continue;
		server.tools = live.tools;
		server.error = live.error;
		server.needsAuth = live.needsAuth;
		server.authUrl = live.authUrl;
	}

	const sortByName = (a: McpServerView, b: McpServerView) => a.name.localeCompare(b.name);
	return {
		global: [...globals.values()].sort(sortByName),
		project: [...projects.values()].sort(sortByName),
		errors: [...global.errors, ...project.errors],
		projectTrusted,
		globalPath,
		projectPath,
	};
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

function toRawEntry(input: McpUpsertInput): RawServerEntry {
	const entry: RawServerEntry = {};
	if (input.transport === "http") {
		entry.url = input.url ?? "";
		entry.type = "http";
		if (input.headers && Object.keys(input.headers).length > 0) entry.headers = input.headers;
	} else {
		entry.command = input.command ?? "";
		if (input.args && input.args.length > 0) entry.args = input.args;
	}
	if (input.description) entry.description = input.description;
	if (input.exposure) entry.exposure = input.exposure;
	if (input.toolExposure && Object.keys(input.toolExposure).length > 0)
		entry.toolExposure = input.toolExposure;
	if (input.enabled === false) entry.enabled = false;
	return entry;
}

export function readRawMcpConfig(scope: "user" | "project", cwd?: string): { path: string; text: string } {
	const path = scope === "project" && cwd ? projectMcpPath(cwd) : globalMcpPath();
	if (!existsSync(path)) return { path, text: `{\n\t"mcpServers": {}\n}\n` };
	try {
		return { path, text: readFileSync(path, "utf8") };
	} catch (error) {
		return { path, text: error instanceof Error ? `\n{}\n` : "{}\n" };
	}
}

export function writeRawMcpConfig(scope: "user" | "project", text: string, cwd?: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("顶层必须是对象");
	const servers = (parsed as RawFile).mcpServers;
	if (servers !== undefined) {
		if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
			throw new Error("mcpServers 必须是对象");
		}
		for (const [name, entry] of Object.entries(servers)) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
				throw new Error(`mcpServers.${name} 必须是对象`);
			}
		}
	}
	const path = scope === "project" && cwd ? projectMcpPath(cwd) : globalMcpPath();
	writeJson(path, parsed);
	log.info("mcp.json 已整份写回", { path, scope });
	return path;
}

export function writeMcpServer(input: McpUpsertInput): string {
	const path = input.scope === "project" && input.cwd ? projectMcpPath(input.cwd) : globalMcpPath();
	const name = input.name.trim();
	if (!name) throw new Error("服务器名称不能为空");
	const file = readFile(path);
	const servers = { ...(file.raw.mcpServers ?? {}) };
	servers[name] = toRawEntry(input);
	writeJson(path, { ...file.raw, mcpServers: servers });
	log.info("mcp server 已写入", { path, name, scope: input.scope });
	return path;
}

export function deleteMcpServer(input: { cwd?: string; name: string }): void {
	const paths = [globalMcpPath()];
	if (input.cwd) paths.unshift(projectMcpPath(input.cwd));
	for (const path of paths) {
		const file = readFile(path);
		const servers = file.raw.mcpServers;
		if (!servers || !(input.name in servers)) continue;
		const next = { ...servers };
		delete next[input.name];
		writeJson(path, { ...file.raw, mcpServers: next });
		log.info("mcp server 已删除", { path, name: input.name });
	}
}
