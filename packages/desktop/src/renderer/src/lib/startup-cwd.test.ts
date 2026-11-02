import type { SessionMeta } from "@tcode/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
	listAllSessions: vi.fn(),
	getDailyDir: vi.fn(() => Promise.resolve(null)),
	saveUiState: vi.fn(() => Promise.resolve()),
	ensureProjectTrust: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../api", () => ({ getPi: () => piMock }));

import { backfillStartupCwd } from "./startup-cwd";
import { useProjectsStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";
import { useUiPreferencesStore } from "../stores/ui-preferences";

function meta(sessionId: string, cwd: string): SessionMeta {
	return {
		sessionId,
		sessionFile: "/sessions/" + sessionId + ".jsonl",
		cwd,
		name: sessionId,
		active: false,
		messageCount: 1,
		createdAt: 1,
		modifiedAt: 1,
	};
}

beforeEach(async () => {
	vi.clearAllMocks();
	piMock.listAllSessions.mockResolvedValue([]);
	piMock.getDailyDir.mockResolvedValue(null);
	useProjectsStore.setState({
		allSessions: [],
		addedProjects: [],
		selectedCwd: null,
		search: "",
		loading: false,
		loaded: false,
	});
	useSessionsStore.setState({
		sessions: [],
		activeSessionId: null,
		cwd: null,
		lastUsedAt: {},
	});
	useUiPreferencesStore.setState({ lastCwd: null });
});

describe("backfillStartupCwd（冷启动补目录）", () => {
	it("lastCwd 缺失时用最近会话的目录补上草稿 cwd", async () => {
		piMock.listAllSessions.mockResolvedValue([meta("s1", "/recent")]);

		await backfillStartupCwd(null);

		expect(useSessionsStore.getState().cwd).toBe("/recent");
		expect(useSessionsStore.getState().newSessionDraft?.cwd).toBe("/recent");
	});

	it("有选中项目时优先用项目目录", async () => {
		piMock.listAllSessions.mockResolvedValue([meta("s1", "/recent")]);
		useProjectsStore.setState({ selectedCwd: "/project" });

		await backfillStartupCwd(null);

		expect(useSessionsStore.getState().cwd).toBe("/project");
	});

	it("已有 cwd 时不动", async () => {
		useSessionsStore.setState({ cwd: "/keep" });
		piMock.listAllSessions.mockResolvedValue([meta("s1", "/recent")]);

		await backfillStartupCwd(null);

		expect(useSessionsStore.getState().cwd).toBe("/keep");
		expect(piMock.listAllSessions).not.toHaveBeenCalled();
	});

	it("没有任何目录时保持 null，不报错", async () => {
		piMock.listAllSessions.mockResolvedValue([]);

		await expect(backfillStartupCwd(null)).resolves.toBeUndefined();

		expect(useSessionsStore.getState().cwd).toBeNull();
	});
});
