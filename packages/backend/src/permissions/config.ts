import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../log";
import type { PermissionAction, PermissionOutside, PermissionRule, PermissionRules } from "./pattern";

const log = createLogger("permission-rules");

export interface PermissionConfig {
	enabled: boolean;

	outside: PermissionOutside;
	rules: PermissionRules;
}

const ACTIONS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

const PROTECTED_FILES = ["permissions.json", "workspaces.json", "auth.json", "trust.json"] as const;

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
	enabled: true,
	outside: { read: "deny", write: "deny", temporary: "allow" },
	rules: {
		"*": "allow",
		bash: {
			"*": "allow",
			"sudo *": "ask",
			"rm -rf *": "ask",
			"rm -fr *": "ask",
			"rm -r *": "ask",
			"rm -r -f *": "ask",
			"rm -f -r *": "ask",
			"rm --recursive *": "ask",
			"mkfs*": "ask",
			"dd *": "ask",
			"shred *": "ask",
			"git push --force*": "ask",
			"git push -f*": "ask",
			"git reset --hard*": "ask",
			"git clean -f*": "ask",
			"git clean --force*": "ask",

			"git restore*": "ask",
			"git checkout -- *": "ask",
			"git stash drop*": "ask",
			"git stash clear*": "ask",
			"git branch -D*": "ask",
			"git commit --amend*": "ask",
			"curl * | sh*": "ask",
			"curl * | bash*": "ask",
			"wget * | sh*": "ask",
			"wget * | bash*": "ask",

			"*permissions.json*": "ask",
			"*workspaces.json*": "ask",
			"*auth.json*": "ask",
			"*trust.json*": "ask",
		},

		...Object.fromEntries(
			["edit", "write"].map((tool) => [
				tool,
				Object.fromEntries(PROTECTED_FILES.map((file) => [`*${file}`, "ask"] as const)),
			]),
		),
	},
};

export function mergeWithDefaults(config: Partial<PermissionConfig>): PermissionConfig {
	return {
		enabled: config.enabled ?? true,
		outside: {
			read: config.outside?.read ?? DEFAULT_PERMISSION_CONFIG.outside.read,
			write: config.outside?.write ?? DEFAULT_PERMISSION_CONFIG.outside.write,
			temporary: config.outside?.temporary ?? DEFAULT_PERMISSION_CONFIG.outside.temporary,
		},
		rules: { ...DEFAULT_PERMISSION_CONFIG.rules, ...(config.rules ?? {}) },
	};
}

function isValidRule(rule: unknown): rule is PermissionRule {
	if (typeof rule === "string") return ACTIONS.has(rule);
	if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return false;
	return Object.values(rule).every((v) => typeof v === "string" && ACTIONS.has(v));
}

function parseOutside(raw: unknown): PermissionOutside | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const input = raw as { read?: unknown; write?: unknown; temporary?: unknown };
	const result: Partial<PermissionOutside> = {};
	if (typeof input.read === "string" && ACTIONS.has(input.read)) {
		result.read = input.read as PermissionAction;
	}
	if (typeof input.write === "string" && ACTIONS.has(input.write)) {
		result.write = input.write as PermissionAction;
	}
	if (typeof input.temporary === "string" && ACTIONS.has(input.temporary)) {
		result.temporary = input.temporary as PermissionAction;
	}
	return result.read || result.write || result.temporary ? (result as PermissionOutside) : undefined;
}

function parseConfig(raw: unknown): Partial<PermissionConfig> {
	if (typeof raw !== "object" || raw === null) return {};
	const input = raw as { enabled?: unknown; outside?: unknown; rules?: unknown };
	const result: Partial<PermissionConfig> = {};
	if (typeof input.enabled === "boolean") result.enabled = input.enabled;
	result.outside = parseOutside(input.outside);
	if (typeof input.rules === "object" && input.rules !== null && !Array.isArray(input.rules)) {
		const rules: PermissionRules = {};
		for (const [tool, rule] of Object.entries(input.rules)) {
			if (tool === "*") {
				if (typeof rule === "string" && ACTIONS.has(rule)) rules["*"] = rule as PermissionAction;
				continue;
			}
			if (isValidRule(rule)) rules[tool] = rule;
		}
		result.rules = rules;
	}
	return result;
}

export function permissionConfigPath(agentDir: string): string {
	return join(agentDir, "permissions.json");
}

export function loadPermissionConfig(agentDir: string): PermissionConfig {
	const path = permissionConfigPath(agentDir);
	if (!existsSync(path)) return mergeWithDefaults({});
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		return mergeWithDefaults(parseConfig(raw));
	} catch (err) {
		log.warn("permissions.json 解析失败，使用默认配置", path, err);
		return mergeWithDefaults({});
	}
}

export function createPermissionConfigLoader(agentDir: string): () => PermissionConfig {
	let cached: { mtimeMs: number | null; config: PermissionConfig } | undefined;
	return () => {
		const path = permissionConfigPath(agentDir);
		let mtimeMs: number | null = null;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			mtimeMs = null;
		}
		if (cached && cached.mtimeMs === mtimeMs) return cached.config;
		const config = loadPermissionConfig(agentDir);
		cached = { mtimeMs, config };
		return config;
	};
}
