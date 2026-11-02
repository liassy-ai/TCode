import type { PiBackend } from "@tcode/backend";
import { createLogger } from "@tcode/backend";
import { app, BrowserWindow, dialog } from "electron";
import { consoleDedupLogLine, consoleSignature, createConsoleDeduper } from "./console-dedup";

const HEARTBEAT_INTERVAL_MS = 60_000;

const log = createLogger("renderer");

function summarizeRates(
	rates: Map<string, { window60s: number[]; lastEventAt: number }>,
	now = Date.now(),
): { id: string; rate1m: number; lastEventAgeMs: number }[] {
	return [...rates.entries()].map(([id, r]) => ({
		id: id.slice(0, 8),
		rate1m: r.window60s.reduce((a, b) => a + b, 0),
		lastEventAgeMs: Math.max(0, now - r.lastEventAt),
	}));
}

function summarizeProcesses(metrics: ReturnType<typeof app.getAppMetrics>) {
	return metrics
		.filter((m) => m.type === "Tab" || m.type === "GPU")
		.map((m) => ({ type: m.type, memoryMb: Math.round(m.memory.workingSetSize / 1024) }));
}

const consoleDedup = createConsoleDeduper();

export function attachRendererWatchdog(backend: PiBackend): void {
	const RELOAD_WINDOW_MS = 30_000;
	const MAX_AUTO_RELOADS = 3;
	const crashReloads: number[] = [];

	const incidentSnapshot = (details: { reason: string; exitCode: number }) => ({
		reason: details.reason,
		exitCode: details.exitCode,
		processes: summarizeProcesses(app.getAppMetrics()),
		sessions: summarizeRates(backend.getEventRates()),
		uptimeMs: Math.round(process.uptime() * 1000),
	});

	app.on("web-contents-created", (_e, contents) => {
		contents.on("render-process-gone", (_event, details) => {
			log.error("render process gone", details);

			if (details.reason === "clean-exit") return;

			log.error("incident snapshot", incidentSnapshot(details));
			const now = Date.now();
			while (crashReloads.length > 0 && now - (crashReloads[0] ?? 0) > RELOAD_WINDOW_MS) crashReloads.shift();
			if (crashReloads.length >= MAX_AUTO_RELOADS) {
				log.error("renderer crash loop, auto reload suspended", {
					windowMs: RELOAD_WINDOW_MS,
					count: crashReloads.length,
				});
				const win = BrowserWindow.fromWebContents(contents);
				const options: Electron.MessageBoxOptions = {
					type: "error",
					title: "TCode",
					message: "界面进程反复崩溃",
					detail: "自动恢复已暂停，避免崩溃循环。可重试加载或退出（后台任务不受影响）。",
					buttons: ["重新加载", "退出"],
					defaultId: 0,
					noLink: true,
				};
				void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)).then(
					({ response }) => {
						if (response === 0) {
							crashReloads.length = 0;
							contents.reload();
						} else {
							app.quit();
						}
					},
				);
				return;
			}
			crashReloads.push(now);
			log.info("renderer crashed, auto reloading", {
				reason: details.reason,
				exitCode: details.exitCode,
			});
			contents.reload();
		});
		contents.on("unresponsive", () => {
			log.warn("renderer unresponsive");
		});
		contents.on("console-message", (details) => {
			const { level, message, lineNumber, sourceId } = details;
			if (level === "error") {
				const signature = consoleSignature(message, sourceId);
				const decision = consoleDedup.observe(signature);
				if (decision.summary) {
					log.error(...consoleDedupLogLine(decision.summary));
				} else if (decision.logFull) {
					log.error("renderer console", { message, line: lineNumber, sourceId });
				}
			} else {
				log.debug("renderer console", { message, line: lineNumber, sourceId });
			}
		});
	});

	const heartbeat = setInterval(() => {
		try {
			const tabs = app.getAppMetrics().filter((m) => m.type === "Tab");
			const rendererMemoryMb = Math.round(tabs.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
			log.info("renderer heartbeat", {
				rendererMemoryMb,
				sessions: summarizeRates(backend.getEventRates()),
			});
		} catch (err) {
			log.warn("renderer heartbeat failed", err);
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();

	const consoleFlush = setInterval(() => {
		for (const summary of consoleDedup.flush()) log.error(...consoleDedupLogLine(summary));
	}, HEARTBEAT_INTERVAL_MS);
	consoleFlush.unref();
}
