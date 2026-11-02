import { createLogger } from "@tcode/backend";
import type {
	NotificationOpenPayload,
	SessionEvent,
	TaskNotification,
	TaskNotificationKind,
} from "@tcode/shared";
import { BrowserWindow, Notification } from "electron";

const log = createLogger("task-notify");

const MIN_GAP_MS = 5_000;

const ERROR_QUIET_MS = 15_000;

const KIND_LABELS: Record<TaskNotificationKind, string> = {
	done: "已完成",
	attention: "需要你确认",
	error: "出错了",
};

const sessionNames = new Map<string, string>();
const lastErrorAt = new Map<string, number>();

let enabled = true;
let lastKey = "";
let lastAt = 0;
let openHandler: ((payload: NotificationOpenPayload) => void) | undefined;

export function setTaskNotifyOpenHandler(handler: (payload: NotificationOpenPayload) => void): void {
	openHandler = handler;
}

export function setTaskNotifyEnabled(next: boolean): void {
	enabled = next;
}

export function rememberSessionNames(entries: ReadonlyArray<{ sessionId: string; name?: string }>): void {
	for (const entry of entries) {
		if (entry.name) sessionNames.set(entry.sessionId, entry.name);
	}
}

export function rememberSessionName(sessionId: string, name: string): void {
	sessionNames.set(sessionId, name);
}

function tailSegment(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

export function sessionDisplayName(sessionId: string): string {
	return sessionNames.get(sessionId) ?? "会话";
}

export function cwdDisplayName(cwd: string): string {
	return tailSegment(cwd);
}

function mainWindowFocused(): boolean {
	return mainWindow()?.isFocused() === true;
}

export function shouldNotify(): boolean {
	return enabled && !mainWindowFocused();
}

function mainWindow(): BrowserWindow | undefined {
	return BrowserWindow.getAllWindows().find(
		(candidate) => !candidate.isDestroyed() && candidate.webContents.getURL().startsWith("http"),
	);
}

function revealWindow(): void {
	const win = mainWindow();
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}

function alertUser(title: string, body: string, onOpen: () => void): boolean {
	if (!Notification.isSupported()) {
		const win = mainWindow();
		if (win && !win.isFocused()) win.flashFrame(true);
		log.warn("系统通知不可用，改为任务栏闪烁", { title });
		return false;
	}
	try {
		const notification = new Notification({ title, body });
		notification.on("click", onOpen);
		notification.show();
		log.info("alert shown", { title });
		return true;
	} catch (error) {
		log.warn("系统通知发送失败", { error: (error as Error).message });
		return false;
	}
}

export function notifyTask(input: TaskNotification): void {
	if (!shouldNotify()) return;

	const key = `${input.sessionId}:${input.kind}`;
	const now = Date.now();
	if (key === lastKey && now - lastAt < MIN_GAP_MS) return;
	lastKey = key;
	lastAt = now;

	const label = KIND_LABELS[input.kind];
	const title = `${input.sessionName} · ${label}`;
	const body = input.detail?.trim() || label;

	alertUser(title, body.slice(0, 200), () => {
		revealWindow();
		openHandler?.({ sessionId: input.sessionId });
	});
}

export function notifyTest(): { shown: boolean } {
	const shown = alertUser("TCode · 测试通知", "任务完成后就会像这样提醒你，点一下通知可回到会话。", () =>
		revealWindow(),
	);
	log.info("test notification", { shown });
	return { shown };
}

export function notifySessionEvent(sessionId: string, event: SessionEvent): void {
	if (event.type === "turn_end") {
		const message = (event as { message?: { stopReason?: string; errorMessage?: string } }).message;
		if (message?.stopReason === "error") {
			lastErrorAt.set(sessionId, Date.now());
			notifyTask({
				kind: "error",
				sessionId,
				sessionName: sessionDisplayName(sessionId),
				detail: message.errorMessage ?? "这一轮出现了错误",
			});
		}
		return;
	}
	if (event.type !== "agent_settled") return;
	const erroredAt = lastErrorAt.get(sessionId);
	if (erroredAt !== undefined && Date.now() - erroredAt < ERROR_QUIET_MS) return;
	notifyTask({ kind: "done", sessionId, sessionName: sessionDisplayName(sessionId) });
}
