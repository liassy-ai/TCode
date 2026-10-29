import { createLogger } from "@tcode/backend";

const log = createLogger("component-bridge");

const COMPONENT_MISSING_MESSAGE = "运行时组件未就绪，无法执行 git 操作";

let componentRunnerProvider: (() => ComponentRunnerLike | undefined) | undefined;

export interface ComponentRunnerLike {
	call(
		req: {
			cmd: string;
			args?: string[];
			cwd?: string;
			gitDir?: string;
			workTree?: string;
			script?: string;
			timeoutMs?: number;
			session?: number;
			env?: Record<string, string>;
			ptyId?: string;
			cols?: number;
			rows?: number;
			data?: string;
			shell?: string;
		},
		onStream?: (data: string, stream: "out" | "err") => void,
	): { id: number; promise: Promise<Record<string, unknown>> } | null;
	sendBridge(req: { cmd: string; session?: number; args?: string[] }): boolean;
	createPty(
		req: {
			ptyId: string;
			cwd: string;
			cols: number;
			rows: number;
			env?: Record<string, string>;
			shell?: string;
		},
		handlers: {
			onData: (data: string) => void;
			onExit: (payload: { code: number; error?: string }) => void;
		},
	): Promise<boolean> | null;
	writePty(ptyId: string, data: string): void;
	resizePty(ptyId: string, cols: number, rows: number): void;
	killPty(ptyId: string): void;
}

export function setComponentRunnerProvider(
	provider: (() => ComponentRunnerLike | undefined) | undefined,
): void {
	componentRunnerProvider = provider;
}

function runner(): ComponentRunnerLike | undefined {
	return componentRunnerProvider?.();
}

export interface ComponentGitOptions {
	gitDir?: string;
	workTree?: string;
	timeoutMs?: number;
	env?: Record<string, string>;
}

export interface ComponentGitResult {
	stdout: string;
	stderr: string;
	code: number;
}

export async function runComponentGit(
	args: string[],
	cwd: string,
	opts: ComponentGitOptions = {},
): Promise<ComponentGitResult> {
	const comp = runner();
	if (!comp) {
		throw new Error(COMPONENT_MISSING_MESSAGE);
	}
	const call = comp.call({
		cmd: "git.exec",
		args,
		cwd,
		gitDir: opts.gitDir,
		workTree: opts.workTree,
		timeoutMs: opts.timeoutMs,
		env: opts.env,
	});
	if (!call) {
		throw new Error(COMPONENT_MISSING_MESSAGE);
	}
	const payload = await call.promise;
	const stdout = await resolveStdout(payload);
	const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
	const code = typeof payload.code === "number" ? payload.code : payload.ok === false ? 1 : 0;
	return { stdout, stderr, code };
}

async function resolveStdout(payload: Record<string, unknown>): Promise<string> {
	if (typeof payload.stdout === "string") return payload.stdout;
	if (typeof payload.file === "string" && payload.file.length > 0) {
		try {
			const { readFile, unlink } = await import("node:fs/promises");
			const content = await readFile(payload.file, "utf8");
			await unlink(payload.file).catch(() => undefined);
			return content;
		} catch (e) {
			log.warn("读取 结果临时文件失败", { file: payload.file, error: (e as Error).message });
			return "";
		}
	}
	return "";
}

export function killShellSession(sessionId: number): void {
	runner()?.sendBridge({ cmd: "shell.kill", session: sessionId });
}

export interface ComponentShellOptions {
	cwd: string;
	script: string;
	timeoutMs?: number;
	env?: Record<string, string>;
	onChunk?: (data: string, stream: "out" | "err") => void;
	onStart?: (callId: number) => void;
}

export interface ComponentShellResult {
	exitCode: number;
	canceled: boolean;
	timedOut: boolean;
	truncated: boolean;
	callId?: number;
}

export async function runComponentShell(opts: ComponentShellOptions): Promise<ComponentShellResult> {
	const comp = runner();
	if (!comp) {
		throw new Error(COMPONENT_MISSING_MESSAGE);
	}
	let streamed = false;
	const onStream = opts.onChunk
		? (data: string, stream: "out" | "err") => {
				streamed = true;
				opts.onChunk?.(data, stream);
			}
		: undefined;
	const call = comp.call(
		{
			cmd: "shell.run",
			cwd: opts.cwd,
			script: opts.script,
			timeoutMs: opts.timeoutMs,
			env: opts.env,
		},
		onStream,
	);
	if (!call) {
		throw new Error(COMPONENT_MISSING_MESSAGE);
	}
	opts.onStart?.(call.id);
	const payload = await call.promise;
	const code = typeof payload.code === "number" ? payload.code : payload.ok === false ? 1 : 0;
	if (opts.onChunk && !streamed) {
		if (typeof payload.stdout === "string" && payload.stdout) opts.onChunk(payload.stdout, "out");
		if (typeof payload.stderr === "string" && payload.stderr) opts.onChunk(payload.stderr, "err");
	}
	return {
		exitCode: code,
		canceled: payload.canceled === true,
		timedOut: payload.timedOut === true,
		truncated: payload.truncated === true,
		callId: call.id,
	};
}

export function killShellCall(callId: number): void {
	runner()?.sendBridge({ cmd: "shell.kill", session: callId });
}

export interface ComponentPtyHandlers {
	onData: (data: string) => void;
	onExit: (payload: { code: number; error?: string }) => void;
}

export function createComponentPty(
	req: {
		ptyId: string;
		cwd: string;
		cols: number;
		rows: number;
		env?: Record<string, string>;
		shell?: string;
	},
	handlers: ComponentPtyHandlers,
): Promise<boolean> | null {
	const comp = runner();
	if (!comp) return null;
	return comp.createPty(req, handlers);
}

export function writeComponentPty(ptyId: string, data: string): void {
	runner()?.writePty(ptyId, data);
}

export function resizeComponentPty(ptyId: string, cols: number, rows: number): void {
	runner()?.resizePty(ptyId, cols, rows);
}

export function killComponentPty(ptyId: string): void {
	runner()?.killPty(ptyId);
}
