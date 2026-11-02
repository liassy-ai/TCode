import { isAbsolute, relative, resolve } from "node:path";
import type { PermissionMode } from "@tcode/shared";
import { createLogger } from "../log";
import { createWorkspacesLoader, suggestRootCandidate } from "../project/workspace-store";
import { type PermissionAuditEntry, PermissionAuditLog, permissionAuditPath } from "./audit";
import { createPermissionConfigLoader } from "./config";
import type { PermissionRequestMeta } from "./gate";
import {
	evaluateBashCommand,
	evaluateRules,
	matchTextFor,
	type PermissionAction,
	patternMatchesToolCall,
	suggestPattern,
} from "./pattern";
import { isRmSegment, isTemporaryPath, rmSegmentExempt } from "./tmp-zone";

const log = createLogger("permission-gate");

const READ_TOOLS = new Set(["read", "ls", "show_image"]);

const WRITE_TOOLS = new Set(["edit", "write"]);
const PATH_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS]);

export type PermissionConfirm = (
	title: string,
	message: string,
	meta?: PermissionRequestMeta,
) => Promise<boolean>;

export interface PermissionGateOptions {
	projectRoot?: string;

	confirm?: PermissionConfirm;

	getMode?: () => PermissionMode;

	evaluator?: PermissionEvaluator;
}

export type PermissionModeRef = { current: PermissionMode };

export interface PermissionEvaluationInput {
	toolName: string;
	input: Record<string, unknown>;
	sessionId?: string;
	cwd?: string;

	uiConfirm?: (title: string, message: string) => Promise<boolean>;
}

export type PermissionEvaluationResult = { verdict: "allow" } | { verdict: "block"; reason: string };

export interface PermissionEvaluator {
	evaluate(input: PermissionEvaluationInput): Promise<PermissionEvaluationResult>;
}

export function createPermissionEvaluator(
	agentDir: string,
	options?: PermissionGateOptions,
): PermissionEvaluator {
	const projectRoot = options?.projectRoot ? resolve(options.projectRoot) : null;
	const loadConfig = createPermissionConfigLoader(agentDir);
	const loadWorkspaces = createWorkspacesLoader(agentDir);
	const audit = new PermissionAuditLog(permissionAuditPath(agentDir));
	return {
		async evaluate(input) {
			const toolName = input.toolName;
			const raw = (input.input ?? {}) as Record<string, unknown>;
			const config = loadConfig();
			if (!config.enabled) return { verdict: "allow" };

			const mode = options?.getMode?.();
			const fullAccess = mode === "fullAccess";

			const viewOnly = mode === "viewOnly";
			const matchText = matchTextFor(toolName, raw);
			if (viewOnly && !READ_TOOLS.has(toolName)) {
				audit.record({
					t: new Date().toISOString(),
					sessionId: input.sessionId,
					tool: toolName,
					action: "deny",
					text: (matchText ?? JSON.stringify(raw)).slice(0, 500),
					cwd: input.cwd,
				});
				log.info("tool blocked by view-only permission mode", toolName);
				return {
					verdict: "block",
					reason: "Blocked by view-only permission mode (only read-only tools are allowed).",
				};
			}

			const base: string | undefined = projectRoot ?? input.cwd;

			const rmExempt = (segment: string): PermissionAction | null =>
				isRmSegment(segment) && rmSegmentExempt(segment, base) ? config.outside.temporary : null;
			const bashResult =
				toolName === "bash" && matchText
					? evaluateBashCommand(config.rules, matchText, "ask", rmExempt)
					: null;
			let action: PermissionAction = bashResult
				? bashResult.action
				: evaluateRules(config.rules, toolName, matchText);

			if (action === "deny") {
				if (fullAccess) {
					audit.record({
						t: new Date().toISOString(),
						sessionId: input.sessionId,
						tool: toolName,
						action: "deny",
						text: (bashResult?.segment ?? matchText ?? JSON.stringify(raw)).slice(0, 500),
						cwd: input.cwd,
					});
					return { verdict: "allow" };
				}
				log.info("tool blocked by rule", toolName, { matchText });
				return {
					verdict: "block",
					reason: `Blocked by permission rule (${toolName}). The user can change this in permissions.json.`,
				};
			}

			const isPath = PATH_TOOLS.has(toolName);
			let patternText: string | null = matchText;
			let outside = false;

			let boundary: PermissionAuditEntry["boundary"];
			if (isPath && matchText) {
				const abs = isAbsolute(matchText) ? matchText : base !== undefined ? resolve(base, matchText) : null;

				if (abs !== null && isTemporaryPath(abs)) {
					patternText = abs;
					if (action === "allow") {
						action = config.outside.temporary;
						if (action !== "allow") boundary = "temporary";
					}
				} else if (projectRoot && abs !== null) {
					const roots = [projectRoot, ...(loadWorkspaces().projects[projectRoot]?.roots ?? [])];
					const inside = roots.some((root) => {
						const rel = relative(root, abs);
						return !rel.startsWith("..") && !isAbsolute(rel);
					});
					patternText = abs;
					if (!inside) {
						outside = true;

						if (action === "allow") {
							action = READ_TOOLS.has(toolName) ? config.outside.read : config.outside.write;
							if (action !== "allow") boundary = READ_TOOLS.has(toolName) ? "outside-read" : "outside-write";
						}

						if (action === "deny") {
							if (fullAccess) {
								audit.record({
									t: new Date().toISOString(),
									sessionId: input.sessionId,
									tool: toolName,
									action: "deny",
									text: (patternText ?? JSON.stringify(raw)).slice(0, 500),
									cwd: input.cwd,
									...(boundary ? { boundary } : {}),
								});
								return { verdict: "allow" };
							}
							log.info("tool blocked outside workspace roots", toolName, { patternText });
							return {
								verdict: "block",
								reason: `Blocked: ${patternText ?? matchText} is outside the workspace folders. The default permission mode only allows work inside the workspace; add the folder as a workspace to allow it.`,
							};
						}
					}
				}
			}

			if (action === "allow") return { verdict: "allow" };

			if (projectRoot) {
				const allowed = loadWorkspaces().projects[projectRoot]?.allowed ?? [];
				if (allowed.some((pattern) => patternMatchesToolCall(pattern, toolName, patternText))) {
					return { verdict: "allow" };
				}
			}

			if (fullAccess) {
				audit.record({
					t: new Date().toISOString(),
					sessionId: input.sessionId,
					tool: toolName,
					action: "ask",
					text: (bashResult?.segment ?? (isPath ? patternText : matchText) ?? JSON.stringify(raw)).slice(
						0,
						500,
					),
					cwd: input.cwd,
					...(boundary ? { boundary } : {}),
				});
				return { verdict: "allow" };
			}

			const title = bashResult
				? suggestPattern("bash", { command: bashResult.segment })
				: isPath && patternText
					? suggestPattern(toolName, { path: patternText })
					: suggestPattern(toolName, raw);
			const detail = matchText ?? JSON.stringify(raw).slice(0, 500);
			const meta = {
				kind: isPath ? ("path" as const) : ("command" as const),

				suggestDir: outside ? (suggestRootCandidate(patternText ?? "") ?? undefined) : undefined,
			};
			const confirm = options?.confirm ?? input.uiConfirm;
			if (!confirm) {
				log.warn("no confirm channel available, blocking tool call", toolName);
				return {
					verdict: "block",
					reason: `Permission confirmation is unavailable for ${toolName}; blocked to stay safe.`,
				};
			}
			let allowed = false;
			try {
				allowed = await confirm(title, detail, meta);
			} catch (err) {
				log.warn("confirm failed, blocking tool call", toolName, err);
			}
			if (allowed) return { verdict: "allow" };
			log.info("tool blocked by user", toolName, { matchText });
			return {
				verdict: "block",
				reason: `User denied this ${toolName} call (${title}). Do not retry the same action; ask the user or find another approach.`,
			};
		},
	};
}
