import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";

const log = createLogger("workspace-store");

const MAX_ALLOWED_PATTERNS = 200;

export interface WorkspaceProjectEntry {
	roots: string[];

	allowed: string[];
}

export interface WorkspacesConfig {
	version: 1;
	projects: Record<string, WorkspaceProjectEntry>;
}

export function emptyWorkspaces(): WorkspacesConfig {
	return { version: 1, projects: {} };
}

export function workspaceConfigPath(agentDir: string): string {
	return join(agentDir, "workspaces.json");
}

function parseEntry(raw: unknown): WorkspaceProjectEntry | null {
	if (typeof raw !== "object" || raw === null) return null;
	const input = raw as { roots?: unknown; allowed?: unknown };
	const roots = Array.isArray(input.roots)
		? input.roots.filter((r): r is string => typeof r === "string" && r.length > 0)
		: [];
	const allowed = Array.isArray(input.allowed)
		? input.allowed.filter((p): p is string => typeof p === "string" && p.length > 0)
		: [];
	return { roots, allowed };
}

function parseWorkspaces(raw: unknown): WorkspacesConfig {
	const config = emptyWorkspaces();
	if (typeof raw !== "object" || raw === null) return config;
	const projects = (raw as { projects?: unknown }).projects;
	if (typeof projects !== "object" || projects === null) return config;
	for (const [root, entry] of Object.entries(projects as Record<string, unknown>)) {
		if (!isAbsolute(root)) continue;
		const parsed = parseEntry(entry);
		if (parsed) config.projects[root] = parsed;
	}
	return config;
}

export function loadWorkspaces(agentDir: string): WorkspacesConfig {
	const store = workspacesStore(agentDir);
	return parseWorkspaces(store.readSync());
}

function workspacesStore(agentDir: string): JsonStore<unknown> {
	return new JsonStore<unknown>({
		path: workspaceConfigPath(agentDir),
		defaultValue: () => null,
	});
}

function mutateEntry(agentDir: string, projectRoot: string, mutate: (entry: WorkspaceProjectEntry) => void) {
	const store = workspacesStore(agentDir);
	store.updateSync((raw) => {
		const config = parseWorkspaces(raw);
		const key = resolve(projectRoot);
		const entry = config.projects[key] ?? { roots: [], allowed: [] };
		mutate(entry);
		if (entry.roots.length === 0 && entry.allowed.length === 0) {
			delete config.projects[key];
		} else {
			config.projects[key] = entry;
		}
		return config;
	});
}

export function addWorkspaceRoot(agentDir: string, projectRoot: string, newRoot: string): void {
	const root = resolve(newRoot);
	mutateEntry(agentDir, projectRoot, (entry) => {
		if (!entry.roots.includes(root)) entry.roots.push(root);
	});
	log.info("workspace root added", { projectRoot: resolve(projectRoot), root });
}

export function removeWorkspaceRoot(agentDir: string, projectRoot: string, root: string): void {
	const target = resolve(root);
	mutateEntry(agentDir, projectRoot, (entry) => {
		entry.roots = entry.roots.filter((r) => r !== target);
	});
	log.info("workspace root removed", { projectRoot: resolve(projectRoot), root: target });
}

export function addAllowedPattern(agentDir: string, projectRoot: string, pattern: string): void {
	mutateEntry(agentDir, projectRoot, (entry) => {
		entry.allowed = entry.allowed.filter((p) => p !== pattern);
		entry.allowed.push(pattern);
		if (entry.allowed.length > MAX_ALLOWED_PATTERNS) {
			entry.allowed = entry.allowed.slice(entry.allowed.length - MAX_ALLOWED_PATTERNS);
		}
	});
	log.info("permission pattern remembered", { projectRoot: resolve(projectRoot), pattern });
}

export function createWorkspacesLoader(agentDir: string): () => WorkspacesConfig {
	let cached: { mtimeMs: number | null; config: WorkspacesConfig } | undefined;
	return () => {
		const path = workspaceConfigPath(agentDir);
		let mtimeMs: number | null = null;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			mtimeMs = null;
		}
		if (cached && cached.mtimeMs === mtimeMs) return cached.config;
		const config = loadWorkspaces(agentDir);
		cached = { mtimeMs, config };
		return config;
	};
}

export function suggestRootCandidate(absPath: string, home: string = homedir()): string | null {
	const unsafe = (dir: string): boolean =>
		dir === "/" || dir === home || home.startsWith(dir + sep) || dir === dirname(home);

	const parent = dirname(absPath);
	if (unsafe(parent)) return null;
	let dir = parent;
	for (;;) {
		if (existsSync(join(dir, ".git")) && !unsafe(dir)) return dir;
		const up = dirname(dir);
		if (up === dir) return parent;
		dir = up;
	}
}
