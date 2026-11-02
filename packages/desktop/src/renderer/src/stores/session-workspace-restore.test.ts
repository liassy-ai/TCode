import type { SessionMeta } from "@tcode/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
	loadUiState: vi.fn(),
	listAllSessions: vi.fn(),
	getDailyDir: vi.fn(() => Promise.resolve(null)),
	openSession: vi.fn(),
	getSessionMessages: vi.fn(() => Promise.resolve([])),
	markSessionHistoryReady: vi.fn(() => Promise.resolve()),
	getFollowUpMessages: vi.fn(() => Promise.resolve([])),
	getTodos: vi.fn(() => Promise.resolve([])),
	getPermissionMode: vi.fn(() => Promise.resolve("default" as const)),
	saveUiState: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve({ closed: true })),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { useProjectsStore } from "./projects";
import { useSessionWorkspaceStore } from "./session-workspace";
import { restoreSessionWorkspace } from "./session-workspace-restore";
import { useSessionsStore } from "./sessions";
import { useUiPreferencesStore } from "./ui-preferences";

const FILE_A = "/sessions/a.jsonl";
const FILE_B = "/sessions/b.jsonl";
const FILE_GONE = "/sessions/gone.jsonl";

function meta(sessionId: string, sessionFile: string, extra: Partial<SessionMeta> = {}): SessionMeta {
	return {
		sessionId,
		sessionFile,
		cwd: "/p",
		name: sessionId,
		active: false,
		messageCount: 2,
		createdAt: 1,
		modifiedAt: 1,
		...extra,
	};
}

function resetStores(): void {
	useSessionWorkspaceStore.setState({ members: [], activeFile: null, epoch: 0 });
	useSessionsStore.setState({ sessions: [], activeSessionId: null, cwd: null, lastUsedAt: {} });
	useProjectsStore.setState({
		allSessions: [],
		selectedCwd: null,
		search: "",
		loading: false,
		loaded: false,
	});
	useUiPreferencesStore.setState({ barSessionsVisible: true, sessionRailEnabled: false });
}

beforeEach(async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
	vi.clearAllMocks();
	piMock.listAllSessions.mockResolvedValue([]);
	piMock.loadUiState.mockResolvedValue({});

	piMock.openSession.mockRejectedValue(new Error("no such session"));
	resetStores();
});

describe("restoreSessionWorkspace（冷启动恢复）", () => {
	it("只按需加载 activeFile 一条：其它成员只进工作区，不调 openSession", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_B], activeFile: FILE_B },
		});
		piMock.listAllSessions.mockResolvedValue([meta("a", FILE_A), meta("b", FILE_B)]);
		piMock.openSession.mockResolvedValue(meta("b", FILE_B));

		await restoreSessionWorkspace();

		expect(piMock.openSession).toHaveBeenCalledTimes(1);
		expect(piMock.openSession).toHaveBeenCalledWith({ filePath: FILE_B });
		expect(useSessionsStore.getState().activeSessionId).toBe("b");

		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A, FILE_B]);
		expect(useSessionWorkspaceStore.getState().activeFile).toBe(FILE_B);
	});

	it("目录对账失败（IPC 抛错）：不裁剪、不写盘、不打开会话", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_B], activeFile: FILE_B },
		});
		piMock.listAllSessions.mockRejectedValue(new Error("目录不可用"));

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members).toEqual([]);
		expect(piMock.openSession).not.toHaveBeenCalled();

		expect(piMock.saveUiState).not.toHaveBeenCalled();
	});

	it("失效项裁剪并落盘修复快照：已删成员、0 消息会话（只有计划路径）都剔除", async () => {
		const FILE_EMPTY = "/sessions/empty.jsonl";
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_GONE, FILE_A, FILE_EMPTY], activeFile: FILE_A },
		});
		piMock.listAllSessions.mockResolvedValue([meta("a", FILE_A)]);
		piMock.openSession.mockResolvedValue(meta("a", FILE_A));

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A]);
		await vi.waitFor(() =>
			expect(piMock.saveUiState).toHaveBeenLastCalledWith({
				state: { sessionWorkspace: { files: [FILE_A], activeFile: FILE_A } },
			}),
		);
	});

	it("activeFile 指向失效项：成员照旧恢复，但不打开任何会话（停在新会话页）", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_GONE], activeFile: FILE_GONE },
		});
		piMock.listAllSessions.mockResolvedValue([meta("a", FILE_A)]);

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A]);
		expect(useSessionWorkspaceStore.getState().activeFile).toBeNull();
		expect(piMock.openSession).not.toHaveBeenCalled();
		expect(useSessionsStore.getState().activeSessionId).toBeNull();
	});

	it("快照为空：不进目录对账也不打开会话（老用户升级路径）", async () => {
		piMock.loadUiState.mockResolvedValue({ pinnedSessions: ["a", "b"] });

		await restoreSessionWorkspace();

		expect(piMock.listAllSessions).not.toHaveBeenCalled();
		expect(piMock.openSession).not.toHaveBeenCalled();
		expect(useSessionWorkspaceStore.getState().members).toEqual([]);
	});

	it("两个显示入口都关：不恢复（工作区语义上就是空的）", async () => {
		useUiPreferencesStore.setState({ barSessionsVisible: false, sessionRailEnabled: false });
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A], activeFile: FILE_A },
		});

		await restoreSessionWorkspace();

		expect(piMock.loadUiState).not.toHaveBeenCalled();
		expect(piMock.listAllSessions).not.toHaveBeenCalled();
		expect(useSessionWorkspaceStore.getState().members).toEqual([]);
	});

	it("用户已经自己导航过（真实导航领号）：恢复成员但不抢焦点", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_B], activeFile: FILE_B },
		});

		piMock.listAllSessions.mockImplementation(() => {
			useSessionsStore.setState({ sessions: [meta("x", "/sessions/x.jsonl")] });
			useSessionsStore.getState().switchSession("x");
			return Promise.resolve([meta("a", FILE_A), meta("b", FILE_B)]);
		});

		await restoreSessionWorkspace();

		expect(piMock.openSession).not.toHaveBeenCalled();
		expect(useSessionsStore.getState().activeSessionId).toBe("x");
		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A, FILE_B]);
	});

	it("用户在目录在途时回新会话页（draft，activeSessionId 仍为 null）：恢复不得把它抢回来", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A], activeFile: FILE_A },
		});

		piMock.listAllSessions.mockImplementation(() => {
			useSessionsStore.getState().activateNewSessionDraft();
			return Promise.resolve([meta("a", FILE_A)]);
		});

		await restoreSessionWorkspace();

		expect(useSessionsStore.getState().activeSessionId).toBeNull();
		expect(piMock.openSession).not.toHaveBeenCalled();
		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A]);

		expect(useSessionWorkspaceStore.getState().activeFile).toBeNull();
		await vi.waitFor(() =>
			expect(piMock.saveUiState).toHaveBeenLastCalledWith({
				state: { sessionWorkspace: { files: [FILE_A], activeFile: null } },
			}),
		);
	});

	it("目录在途时用户自己打开了 C：C 不被快照覆盖（并入而非替换），也保留用户的当前指针", async () => {
		const FILE_C = "/sessions/c.jsonl";
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_B], activeFile: FILE_B },
		});

		piMock.listAllSessions.mockImplementation(() => {
			useSessionWorkspaceStore.getState().addMember({ file: FILE_C, sessionId: "c" });
			return Promise.resolve([meta("a", FILE_A), meta("b", FILE_B), meta("c", FILE_C)]);
		});

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A, FILE_B, FILE_C]);
		expect(useSessionWorkspaceStore.getState().activeFile).toBe(FILE_C);
		expect(piMock.openSession).not.toHaveBeenCalled();
		expect(useSessionsStore.getState().activeSessionId).toBeNull();
		await vi.waitFor(() =>
			expect(piMock.saveUiState).toHaveBeenLastCalledWith({
				state: { sessionWorkspace: { files: [FILE_A, FILE_B, FILE_C], activeFile: FILE_C } },
			}),
		);
	});

	it("恢复自己读目录（不依赖 projects.load 的返回值）：读到了就落 store", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A], activeFile: FILE_A },
		});
		piMock.listAllSessions.mockResolvedValue([meta("a", FILE_A)]);
		piMock.openSession.mockResolvedValue(meta("a", FILE_A));

		await restoreSessionWorkspace();

		expect(piMock.listAllSessions).toHaveBeenCalledTimes(1);

		expect(useProjectsStore.getState().allSessions.map((s) => s.sessionId)).toEqual(["a"]);
		expect(useProjectsStore.getState().loaded).toBe(true);
	});

	it("恢复途中用户关掉开关清空工作区：迟到的恢复不得把成员复活", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A, FILE_B], activeFile: FILE_B },
		});
		piMock.listAllSessions.mockImplementation(() => {
			useUiPreferencesStore.setState({ barSessionsVisible: false, sessionRailEnabled: false });
			return Promise.resolve([meta("a", FILE_A), meta("b", FILE_B)]);
		});

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members).toEqual([]);
		expect(piMock.openSession).not.toHaveBeenCalled();
	});

	it("本次进程已经恢复过（或用户已开过会话）：幂等返回，不重放", async () => {
		useSessionWorkspaceStore.setState({ members: [{ file: FILE_A, sessionId: "a" }] });

		await restoreSessionWorkspace();

		expect(piMock.loadUiState).not.toHaveBeenCalled();
	});

	it("恢复打开失败（文件已不在磁盘）：不 panic、不改工作区，交由按需打开报错", async () => {
		piMock.loadUiState.mockResolvedValue({
			sessionWorkspace: { files: [FILE_A], activeFile: FILE_A },
		});
		piMock.listAllSessions.mockResolvedValue([meta("a", FILE_A)]);
		piMock.openSession.mockRejectedValue(new Error("ENOENT"));

		await restoreSessionWorkspace();

		expect(useSessionWorkspaceStore.getState().members.map((m) => m.file)).toEqual([FILE_A]);
		expect(useSessionsStore.getState().activeSessionId).toBeNull();
	});
});
