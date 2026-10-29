import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { PermissionMode } from "@tcode/shared";
import { describe, expect, it } from "vitest";
import type { PermissionAuditEntry } from "../src/permissions/audit";
import { permissionAuditPath } from "../src/permissions/audit";
import { makePermissionGateExtension, type PermissionConfirm } from "../src/permissions/extension";
import { PermissionGate } from "../src/permissions/gate";
import { workspaceConfigPath } from "../src/project/workspace-store";

type ToolCallHandler = ExtensionHandler<ToolCallEvent, ToolCallEventResult>;

type PermissionModeRef = { current: PermissionMode };

function readAudit(agentDir: string): PermissionAuditEntry[] {
	const path = permissionAuditPath(agentDir);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as PermissionAuditEntry);
}

interface ConfirmCall {
	title: string;
	message: string;
	kind?: "path" | "command" | "other";
	suggestDir?: string;
}

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-perm-ext-"));
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeHarness(
	agentDir: string,
	confirmAnswer: boolean | ((title: string) => boolean) = false,
	options?: { projectRoot?: string; confirmCalls?: ConfirmCall[]; cwd?: string; mode?: PermissionModeRef },
) {
	const confirmCalls = options?.confirmCalls;
	const confirm: PermissionConfirm | undefined = confirmCalls
		? async (title, message, meta) => {
				confirmCalls.push({ title, message, ...meta });
				return typeof confirmAnswer === "function" ? confirmAnswer(title) : confirmAnswer;
			}
		: undefined;
	const mode = options?.mode;
	const extension = makePermissionGateExtension(agentDir, {
		projectRoot: options?.projectRoot,
		confirm,
		getMode: mode ? () => mode.current : undefined,
	});
	if (typeof extension === "function" || !("factory" in extension)) {
		throw new Error("expected named inline extension");
	}
	let handler: ToolCallHandler | undefined;
	const pi = {
		on: (event: string, h: ToolCallHandler) => {
			if (event === "tool_call") handler = h;
		},
	};
	extension.factory(pi as unknown as ExtensionAPI);
	if (!handler) throw new Error("tool_call handler not registered");

	const confirms: { title: string; message: string }[] = [];
	const ctx = {
		cwd: options?.cwd ?? homedir(),
		ui: {
			confirm: async (title: string, message: string) => {
				confirms.push({ title, message });
				return typeof confirmAnswer === "function" ? confirmAnswer(title) : confirmAnswer;
			},
		},
	} as unknown as ExtensionContext;

	const call = (toolName: string, input: Record<string, unknown>) =>
		handler({ type: "tool_call", toolCallId: "tc-1", toolName, input } as ToolCallEvent, ctx);
	return { call, confirms };
}

describe("permission-gate 扩展", () => {
	it("默认规则：普通 bash/文件工具直接放行，不弹窗", async () => {
		const { call, confirms } = makeHarness(makeAgentDir());
		await expect(call("bash", { command: "npm test" })).resolves.toBeUndefined();
		await expect(call("edit", { path: "/tmp/a.ts" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(0);
	});

	it("高危命令弹窗；用户允许则放行", async () => {
		const { call, confirms } = makeHarness(makeAgentDir(), true);
		await expect(call("bash", { command: "rm -rf /etc/perm-x" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(1);
		expect(confirms[0].title).toBe("bash: rm -rf*");
		expect(confirms[0].message).toBe("rm -rf /etc/perm-x");
	});

	it("高危命令弹窗；用户拒绝则 block 并给 LLM reason", async () => {
		const { call } = makeHarness(makeAgentDir(), false);
		const result = await call("bash", { command: "sudo rm -rf /" });
		expect(result).toMatchObject({ block: true });
		expect((result as ToolCallEventResult).reason).toContain("denied");
	});

	it("命令链中藏高危命令同样弹窗；标题定位危险段", async () => {
		const { call, confirms } = makeHarness(makeAgentDir(), false);
		const result = await call("bash", { command: "cd /tmp && ls && rm -rf /etc/xxx" });
		expect(result).toMatchObject({ block: true });
		expect((result as ToolCallEventResult).reason).toContain("denied");
		expect(confirms).toHaveLength(1);
		expect(confirms[0].title).toBe("bash: rm -rf*");
		expect(confirms[0].message).toBe("cd /tmp && ls && rm -rf /etc/xxx");
	});

	it("deny 规则直接 block，不弹窗", async () => {
		const dir = makeAgentDir();
		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "allow", "git push *": "deny" } } }),
		);
		const { call, confirms } = makeHarness(dir, true);
		const result = await call("bash", { command: "git push origin main" });
		expect(result).toMatchObject({ block: true });
		expect((result as ToolCallEventResult).reason).toContain("permission rule");
		expect(confirms).toHaveLength(0);
	});

	it("enabled=false 整体放行", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ enabled: false }));
		const { call, confirms } = makeHarness(dir, false);
		await expect(call("bash", { command: "rm -rf /" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(0);
	});

	it("自保护默认规则：触及权限/凭证配置的 bash 与 edit/write 必确认", async () => {
		const { call, confirms } = makeHarness(makeAgentDir(), false);
		await expect(call("bash", { command: "cat ~/.pi/agent/permissions.json" })).resolves.toMatchObject({
			block: true,
		});
		await expect(call("edit", { path: "/somewhere/auth.json" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(2);
	});

	it("项目边界：界外写直接拒绝（含 ../../ 相对逃逸），界内与不设边界放行", async () => {
		const dir = makeAgentDir();
		const root = join(dir, "proj");
		mkdirSync(root, { recursive: true });
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });

		await expect(call("edit", { path: join(root, "a.ts") })).resolves.toBeUndefined();
		await expect(call("read", { path: "src/b.ts" })).resolves.toBeUndefined();

		const outsideResult = await call("edit", { path: "/etc/hosts" });
		expect(outsideResult).toMatchObject({ block: true });
		expect((outsideResult as ToolCallEventResult).reason).toContain("outside the workspace");
		await expect(call("write", { path: "../../../escape.ts" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(0);

		const open = makeHarness(dir, false);
		await expect(open.call("edit", { path: "/etc/hosts" })).resolves.toBeUndefined();

		await expect(call("bash", { command: "ls /etc" })).resolves.toBeUndefined();
	});

	it("默认档越界一律拒绝：界外读写都 block 且不弹窗；加成工作区根后放行", async () => {
		const dir = makeAgentDir();

		const root = join(process.cwd(), ".perm-ext-ws");
		const other = join(process.cwd(), ".perm-ext-outside");
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });

		await expect(call("read", { path: join(homedir(), ".perm-ext-host.txt") })).resolves.toMatchObject({
			block: true,
		});
		await expect(call("ls", { path: other })).resolves.toMatchObject({ block: true });

		const outsideWrite = await call("edit", { path: join(other, "a.ts") });
		expect(outsideWrite).toMatchObject({ block: true });
		expect((outsideWrite as ToolCallEventResult).reason).toContain("outside the workspace");
		expect(confirms).toHaveLength(0);

		await expect(call("read", { path: join(root, "a.ts") })).resolves.toBeUndefined();
		await expect(call("edit", { path: join(root, "b.ts") })).resolves.toBeUndefined();

		writeFileSync(
			workspaceConfigPath(dir),
			JSON.stringify({ version: 1, projects: { [root]: { roots: [other], allowed: [] } } }),
		);
		const granted = makeHarness(dir, false, { projectRoot: root });
		await expect(granted.call("edit", { path: join(other, "a.ts") })).resolves.toBeUndefined();
		expect(granted.confirms).toHaveLength(0);
	});

	it("outside.read=ask：显式写文件放松后界外读确认（默认是 deny）", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ outside: { read: "ask" } }));
		const root = join(dir, "proj");
		mkdirSync(root, { recursive: true });
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });
		await expect(call("read", { path: "/etc/hosts" })).resolves.toMatchObject({ block: true });

		await expect(call("read", { path: join(root, "a.ts") })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(1);
	});

	it("工作区多根：根集合内的路径视为界内直接放行", async () => {
		const dir = makeAgentDir();
		const root = join(dir, "proj");
		const other = join(dir, "other-repo");
		mkdirSync(root, { recursive: true });
		mkdirSync(join(other, "src"), { recursive: true });
		writeFileSync(
			workspaceConfigPath(dir),
			JSON.stringify({ version: 1, projects: { [root]: { roots: [other], allowed: [] } } }),
		);
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });

		await expect(call("edit", { path: join(other, "src", "a.ts") })).resolves.toBeUndefined();
		await expect(call("read", { path: join(other, "README.md") })).resolves.toBeUndefined();

		await expect(call("edit", { path: "/etc/hosts" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(0);
	});

	it("项目记忆（allowAlways 持久化）：allowed 模式命中不再弹窗；deny 与越界 deny 不可被记忆覆盖", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ rules: { bash: { "*": "ask" } } }));
		const root = join(dir, "proj");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			workspaceConfigPath(dir),
			JSON.stringify({
				version: 1,
				projects: { [root]: { roots: [], allowed: ["bash: npm test*", "write: /safe/*"] } },
			}),
		);
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });

		await expect(call("bash", { command: "npm test" })).resolves.toBeUndefined();
		await expect(call("bash", { command: "cd /tmp && npm test --watch" })).resolves.toBeUndefined();

		await expect(call("bash", { command: "npm run build" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(1);

		await expect(call("write", { path: "/safe/notes.md" })).resolves.toMatchObject({ block: true });

		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "ask", "npm test *": "deny" } } }),
		);
		await expect(call("bash", { command: "npm test -- --grep x" })).resolves.toMatchObject({ block: true });
	});

	it("ask 元数据：path 类带 kind/suggestDir（git 根候选）；bash 为 command 无 suggestDir", async () => {
		const dir = makeAgentDir();

		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ outside: { write: "ask" } }));
		const root = join(dir, "proj");

		const fixtureBase = mkdtempSync(join(process.cwd(), ".perm-ext-fixture-"));
		const repo = join(fixtureBase, "other-repo");
		mkdirSync(root, { recursive: true });
		mkdirSync(join(repo, "sub"), { recursive: true });
		mkdirSync(join(repo, ".git"));
		try {
			const calls: ConfirmCall[] = [];
			const { call } = makeHarness(dir, false, { projectRoot: root, confirmCalls: calls });
			await call("edit", { path: join(repo, "sub", "a.ts") });
			await call("bash", { command: "rm -rf /etc/perm-x" });
			expect(calls[0]).toMatchObject({ kind: "path", suggestDir: repo });
			expect(calls[1]).toMatchObject({ kind: "command" });
			expect(calls[1].suggestDir).toBeUndefined();
		} finally {
			rmSync(fixtureBase, { recursive: true, force: true });
		}
	});

	it("自定义工具吃工具名级规则", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ rules: { my_tool: "deny" } }));
		const { call } = makeHarness(dir);
		await expect(call("my_tool", { foo: 1 })).resolves.toMatchObject({ block: true });
		await expect(call("other_tool", { foo: 1 })).resolves.toBeUndefined();
	});

	it("ask 走 PermissionGate：allowAlways 后同模式不再弹窗", async () => {
		const dir = makeAgentDir();
		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "ask", "git *": "allow" } } }),
		);
		const extension = makePermissionGateExtension(dir);
		if (typeof extension === "function" || !("factory" in extension)) throw new Error("unexpected");
		let handler: ToolCallHandler | undefined;
		extension.factory({
			on: (_event: string, h: ToolCallHandler) => {
				handler = h;
			},
		} as unknown as ExtensionAPI);

		const confirms: string[] = [];
		const gate = new PermissionGate((req) => {
			confirms.push(req.title);
			queueMicrotask(() => gate.respond(req.id, "allowAlways"));
		});
		gate.bindSession("s1");
		const ctx = {
			ui: {
				confirm: (title: string, message: string) => gate.confirm(title, message),
			},
		} as unknown as ExtensionContext;
		const call = (command: string) =>
			handler?.(
				{ type: "tool_call", toolCallId: "tc", toolName: "bash", input: { command } } as ToolCallEvent,
				ctx,
			);

		await expect(call("npm test")).resolves.toBeUndefined();
		await expect(call("npm run build")).resolves.toBeUndefined();
		await expect(call("npm test --watch")).resolves.toBeUndefined();

		expect(confirms).toEqual(["bash: npm test*", "bash: npm run*"]);
	});

	it("临时区默认放行：write/edit 落 tmp 不弹窗；rm 删 tmp 目标跳过兜底；穿越/混合目标仍确认", async () => {
		const { call, confirms } = makeHarness(makeAgentDir(), false);
		await expect(call("write", { path: `${resolve(tmpdir())}/x.ts` })).resolves.toBeUndefined();
		await expect(call("edit", { path: "/tmp/y.ts" })).resolves.toBeUndefined();
		await expect(call("bash", { command: `rm -rf ${resolve(tmpdir())}/sub/` })).resolves.toBeUndefined();
		await expect(call("bash", { command: "rm -rf /tmp/a /tmp/b" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(0);

		await expect(call("bash", { command: "rm -rf /tmp/../etc/perm-test" })).resolves.toMatchObject({
			block: true,
		});
		await expect(call("bash", { command: "rm -rf /tmp/a /etc/b" })).resolves.toMatchObject({ block: true });
		expect(confirms.map((c) => c.title)).toEqual(["bash: rm -rf*", "bash: rm -rf*"]);
	});

	it("自保护规则不受临时区影响：tmp 下的 permissions.json 写入仍确认（显式 ask 不被放松）", async () => {
		const { call, confirms } = makeHarness(makeAgentDir(), false);
		await expect(call("write", { path: `${resolve(tmpdir())}/permissions.json` })).resolves.toMatchObject({
			block: true,
		});
		expect(confirms).toHaveLength(1);
	});

	it("outside.temporary=ask 收紧：tmp 写与 tmp rm 目标从默认放行变确认", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ outside: { temporary: "ask" } }));
		const { call, confirms } = makeHarness(dir, false);
		await expect(call("write", { path: `${resolve(tmpdir())}/x.ts` })).resolves.toMatchObject({
			block: true,
		});
		await expect(call("bash", { command: `rm -rf ${resolve(tmpdir())}/x` })).resolves.toMatchObject({
			block: true,
		});
		expect(confirms.map((c) => c.title)).toEqual([`write: ${resolve(tmpdir())}${sep}*`, "bash: rm -rf*"]);
	});

	it("outside.temporary=deny 收紧：tmp 写走确认（拒→block）；rm tmp 目标在求值层直接 block（deny 地板）", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ outside: { temporary: "deny" } }));
		const { call, confirms } = makeHarness(dir, false);
		await expect(call("write", { path: "/tmp/x.ts" })).resolves.toMatchObject({ block: true });
		const rmResult = await call("bash", { command: "rm -rf /tmp/x" });
		expect(rmResult).toMatchObject({ block: true });
		expect((rmResult as ToolCallEventResult).reason).toContain("permission rule");
		expect(confirms).toHaveLength(1);
	});

	it("用户显式 deny 永不被 temporary=allow 覆盖（rm -rf /tmp/precious* 直接 block 不弹窗）", async () => {
		const dir = makeAgentDir();
		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "allow", "rm -rf /tmp/precious*": "deny" } } }),
		);
		const { call, confirms } = makeHarness(dir, false);
		const result = await call("bash", { command: "rm -rf /tmp/precious-data" });
		expect(result).toMatchObject({ block: true });
		expect((result as ToolCallEventResult).reason).toContain("permission rule");
		expect(confirms).toHaveLength(0);
	});

	it("projectRoot 本身在临时区：地理优先，按 temporary 语义处置（ask → 确认）", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ outside: { temporary: "ask" } }));
		const root = join(dir, "proj");
		const { call, confirms } = makeHarness(dir, false, { projectRoot: root });
		await expect(call("write", { path: join(root, "a.ts") })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(1);
	});

	it("rm 相对目标按 ctx.cwd resolve：cwd 在临时区 → 豁免；不在 → 确认", async () => {
		const inTmp = makeHarness(makeAgentDir(), false, { cwd: resolve(tmpdir()) });
		await expect(inTmp.call("bash", { command: "rm -rf sub/x" })).resolves.toBeUndefined();
		expect(inTmp.confirms).toHaveLength(0);
		const atHome = makeHarness(makeAgentDir(), false, { cwd: homedir() });
		await expect(atHome.call("bash", { command: "rm -rf sub/x" })).resolves.toMatchObject({ block: true });
		expect(atHome.confirms).toHaveLength(1);
	});
});

describe("权限模式（fullAccess = 一切放行 + 高危审计）", () => {
	it("fullAccess：ask 规则（rm -rf）放行并审计命中段；不弹窗", async () => {
		const dir = makeAgentDir();
		const { call, confirms } = makeHarness(dir, false, { mode: { current: "fullAccess" } });
		await expect(call("bash", { command: "cd /tmp && ls && rm -rf /etc/xxx" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(0);
		const entries = readAudit(dir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ tool: "bash", action: "ask", text: "rm -rf /etc/xxx" });
	});

	it("fullAccess：deny 规则同样降级为记录 + 放行（含自保护规则）", async () => {
		const dir = makeAgentDir();
		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "allow", "git push *": "deny" } } }),
		);
		const { call, confirms } = makeHarness(dir, false, { mode: { current: "fullAccess" } });
		await expect(call("bash", { command: "git push origin main" })).resolves.toBeUndefined();
		await expect(call("write", { path: "/somewhere/auth.json" })).resolves.toBeUndefined();
		expect(confirms).toHaveLength(0);
		const entries = readAudit(dir);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ tool: "bash", action: "deny", text: "git push origin main" });
		expect(entries[1]).toMatchObject({ tool: "write", action: "ask" });
	});

	it("fullAccess：普通命令放行且无审计行", async () => {
		const dir = makeAgentDir();
		const { call } = makeHarness(dir, false, { mode: { current: "fullAccess" } });
		await expect(call("bash", { command: "ls" })).resolves.toBeUndefined();
		await expect(call("read", { path: "/etc/hosts" })).resolves.toBeUndefined();
		expect(readAudit(dir)).toHaveLength(0);
	});

	it("fullAccess：界外写按越界 deny 留痕（带 boundary 与 resolve 后绝对路径）；项目记忆命中不记", async () => {
		const dir = makeAgentDir();

		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ rules: { bash: { "*": "ask" } } }));
		const root = join(dir, "proj");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			workspaceConfigPath(dir),
			JSON.stringify({
				version: 1,
				projects: { [root]: { roots: [], allowed: ["bash: npm test*"] } },
			}),
		);
		const { call } = makeHarness(dir, false, { projectRoot: root, mode: { current: "fullAccess" } });

		await expect(call("bash", { command: "npm test --watch" })).resolves.toBeUndefined();
		expect(readAudit(dir)).toHaveLength(0);

		await expect(call("write", { path: "../../../escape-audit.ts" })).resolves.toBeUndefined();

		await expect(call("bash", { command: "npm run build" })).resolves.toBeUndefined();
		const entries = readAudit(dir);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			tool: "write",
			action: "deny",
			boundary: "outside-write",
			text: resolve(root, "../../../escape-audit.ts"),
		});
		expect(entries[1]).toMatchObject({ tool: "bash", action: "ask", text: "npm run build" });
	});

	it("fullAccess：enabled=false 逃生舱仍在（无审计，整体放行）", async () => {
		const dir = makeAgentDir();
		writeFileSync(join(dir, "permissions.json"), JSON.stringify({ enabled: false }));
		const { call } = makeHarness(dir, false, { mode: { current: "fullAccess" } });
		await expect(call("bash", { command: "rm -rf /" })).resolves.toBeUndefined();
		expect(readAudit(dir)).toHaveLength(0);
	});

	it("default 回归：无 getMode 时行为与现状一致（deny block / ask confirm）", async () => {
		const dir = makeAgentDir();
		writeFileSync(
			join(dir, "permissions.json"),
			JSON.stringify({ rules: { bash: { "*": "allow", "git push *": "deny", "rm -rf *": "ask" } } }),
		);
		const { call, confirms } = makeHarness(dir, false);
		await expect(call("bash", { command: "git push origin main" })).resolves.toMatchObject({ block: true });
		await expect(call("bash", { command: "rm -rf /etc/x" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(1);
		expect(readAudit(dir)).toHaveLength(0);
	});

	it("模式切换即时生效：同 holder default→fullAccess→default，行为逐调用跟随", async () => {
		const dir = makeAgentDir();
		const mode: PermissionModeRef = { current: "default" };
		const { call, confirms } = makeHarness(dir, false, { mode });
		await expect(call("bash", { command: "rm -rf /etc/x" })).resolves.toMatchObject({ block: true });
		mode.current = "fullAccess";
		await expect(call("bash", { command: "rm -rf /etc/x" })).resolves.toBeUndefined();
		mode.current = "default";
		await expect(call("bash", { command: "rm -rf /etc/x" })).resolves.toMatchObject({ block: true });
		expect(confirms).toHaveLength(2);
		const entries = readAudit(dir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ action: "ask", tool: "bash" });
	});
});
