import "./pi-package-dir";
import "./dev-agent-dir";
import "./fix-path";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger, initLogging, PiBackend, setCheckIgnoreOverride } from "@tcode/backend";
import { type ComponentLicense, FEATURE_GATED_SKILLS, IpcChannels } from "@tcode/shared";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol } from "electron";
import { backgroundsDir } from "./background";
import { setupBrowserHardening } from "./browser";
import { makeBrowserControlTool } from "./browser-control";
import {
	ensureBuiltinSkills,
	readSeededSkillBody,
	TCODE_BROWSER_SKILL,
	TCODE_RULES_SKILL,
} from "./builtin-skills";
import { makeComponentBashTool } from "./component-bash";
import { runComponentGit, setComponentRunnerProvider } from "./component-bridge";
import { ComponentNotifyHost } from "./component-notify";
import { ComponentProfileHost } from "./component-profile";
import { ComponentProviders } from "./component-providers";
import { ComponentRunner } from "./component-run";
import { getDailyDir } from "./daily";
import { registerIpc, sendToRenderer } from "./ipc";
import { invokeRegistry } from "./ipc/invoke";
import { ManagedConfig } from "./managed-config";
import { attachRendererWatchdog } from "./renderer-watchdog";
import { ServiceLink } from "./service-link";
import { installSessionSecurityCsp } from "./session-security";
import { loadUiPluginsConfig } from "./ui-plugins/config";
import { UiPluginManager, uiPluginsResourcesDir } from "./ui-plugins/manager";
import { loadUiState, onUiStateSaved } from "./ui-state";
import { UpdateManager } from "./updater";
import { WebBridgeService } from "./web-bridge";
import { applyChromeTheme, createWindow, markQuitting, resolveTheme } from "./window";

const log = createLogger("main");
let backend: PiBackend;

interface FeatureGateSnapshot {
	skills: ReadonlySet<string>;

	tools: ReadonlySet<string>;
}
let featureGateSnapshot: FeatureGateSnapshot = { skills: new Set<string>(), tools: new Set<string>() };
async function warmFeatureGates(): Promise<FeatureGateSnapshot> {
	const skills = new Set<string>();
	const tools = new Set<string>();
	const state = await loadUiState().catch(() => null);
	const browser = state?.browserControl === true;

	const channelWatch = backend.getChannelWatchConfig().enabled === true;
	for (const [skillName, feature] of Object.entries(FEATURE_GATED_SKILLS)) {
		if (feature === "browserControl") {
			if (!browser) skills.add(skillName);
		} else if (feature === "crossSessionCollab") {
			if (!channelWatch) skills.add(skillName);
		} else {
			const config = await loadUiPluginsConfig().catch(() => null);
			if (!config?.enabled) skills.add(skillName);
		}
	}

	if (!browser) tools.add("browser");
	featureGateSnapshot = { skills, tools };
	return featureGateSnapshot;
}
let uiPluginsManager: UiPluginManager;

let browserControlOn = false;
let webBridge: WebBridgeService | undefined;
let managedConfig: ManagedConfig | undefined;
let componentProviders: ComponentProviders | undefined;
let componentRunner: ComponentRunner | undefined;
let componentNotify: ComponentNotifyHost | undefined;
let componentProfile: ComponentProfileHost | undefined;
let componentLicenses: ComponentLicense[] = [];
let serviceLink: ServiceLink | undefined;

function desktopSystemPrompt(): string[] {
	const parts: string[] = [];

	const body = readSeededSkillBody(TCODE_RULES_SKILL);
	if (body) parts.push(body);
	else console.warn("[desktop-prompt] 读不到 tcode-desktop 技能正文：本次会话不带桌面端规则");
	if (browserControlOn) {
		const browser = readSeededSkillBody(TCODE_BROWSER_SKILL);
		if (browser) parts.push(browser);
	}
	return parts;
}

const BG_PROTOCOL = "pi-bg";

protocol.registerSchemesAsPrivileged([
	{ scheme: BG_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (process.platform !== "darwin") Menu.setApplicationMenu(null);

nativeTheme.on("updated", () => applyChromeTheme(nativeTheme.themeSource));

if (!app.requestSingleInstanceLock()) {
	app.exit(0);
}
app.on("second-instance", () => {
	const [win] = BrowserWindow.getAllWindows();
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
});

app.whenReady().then(async () => {
	initLogging(join(app.getPath("userData"), "logs"));
	log.info("app ready", { version: app.getVersion(), userData: app.getPath("userData") });

	componentProviders = new ComponentProviders();
	componentProviders.setHandler((raw) => {
		void backend
			?.setPluginProviders(raw)
			.then(() => sendToRenderer(IpcChannels.ManagedConfigChanged, undefined))
			.catch((error) => log.warn("内置供应商应用失败", (error as Error).message));
	});
	componentRunner = new ComponentRunner();
	setComponentRunnerProvider(() => componentRunner);
	setCheckIgnoreOverride(async (cwd, rel) => {
		try {
			const { code } = await runComponentGit(["check-ignore", "-q", rel], cwd, { timeoutMs: 5000 });
			if (code === 0) return "ignored";
			if (code === 1) return "not-ignored";
			return "not-git";
		} catch {
			return "not-git";
		}
	});
	componentRunner.setFatalHandler((reason) => {
		const zh = app.getLocale().toLowerCase().startsWith("zh");
		const missing = reason === "missing";
		for (const w of BrowserWindow.getAllWindows()) {
			try {
				w.destroy();
			} catch {}
		}
		dialog.showErrorBox(
			zh ? "无法启动" : "Cannot start",
			zh
				? missing
					? "程序文件缺失，请重新安装软件。"
					: "程序文件已损坏，请重新安装软件。"
				: missing
					? "Program files are missing. Please reinstall the application."
					: "Program files are damaged. Please reinstall the application.",
		);
		app.exit(0);
	});
	componentNotify = new ComponentNotifyHost();
	componentNotify.setEmitter((n) => sendToRenderer(IpcChannels.PluginNotify, n));
	componentProfile = new ComponentProfileHost();
	componentProfile.setEmitter((p) => sendToRenderer(IpcChannels.PluginProfileChanged, p));
	componentRunner.setEmitter((n) => componentNotify?.deliver(n));
	componentRunner.setProvidersHandler((raw) => componentProviders?.deliver(raw));
	componentRunner.setProfileHandler((p) => componentProfile?.deliver(p));
	componentRunner.setLicensesHandler((raw) => {
		const items = (raw as { items?: unknown } | null)?.items;
		if (!Array.isArray(items)) {
			componentLicenses = [];
			return;
		}
		componentLicenses = items
			.filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
			.filter((it) => typeof it.name === "string" && it.name.length > 0)
			.map((it) => ({
				name: it.name as string,
				description: typeof it.description === "string" ? it.description : undefined,
				descriptionEn: typeof it.descriptionEn === "string" ? it.descriptionEn : undefined,
				license: typeof it.license === "string" ? it.license : undefined,
				author: typeof it.author === "string" ? it.author : undefined,
			}));
	});
	componentRunner.start();
	serviceLink = new ServiceLink();
	serviceLink.setEmitter((n) => componentNotify?.deliverGuard(n));
	serviceLink.start();

	if (!(await componentRunner.waitReady(20000))) {
		log.error("组件未就绪，不启动后端");
		dialog.showErrorBox(
			app.getLocale().toLowerCase().startsWith("zh") ? "无法启动" : "Cannot start",
			app.getLocale().toLowerCase().startsWith("zh")
				? "程序文件缺失，请重新安装软件。"
				: "Program files are missing. Please reinstall the application.",
		);
		app.exit(0);
		return;
	}

	const seededSkill = ensureBuiltinSkills();
	if (seededSkill) console.log(`[builtin-skills] seeded → ${seededSkill}`);

	browserControlOn = (await loadUiState().catch(() => null))?.browserControl === true;

	onUiStateSaved((patch) => {
		if (typeof patch.browserControl === "boolean") {
			browserControlOn = patch.browserControl;
			console.log(`[desktop-prompt] 浏览器控制 = ${browserControlOn}（下次会话的系统提示词随之变化）`);
		}
	});

	protocol.handle(BG_PROTOCOL, (request) => {
		const name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
		if (!/^[\w.-]+$/.test(name)) return new Response("invalid background name", { status: 400 });
		return net.fetch(pathToFileURL(join(backgroundsDir(), name)).toString());
	});

	backend = new PiBackend({
		desktopIntegration: {
			appendSystemPrompt: () => desktopSystemPrompt(),
			additionalSkillPaths: [
				join(uiPluginsResourcesDir(), "skills"),

				app.isPackaged ? join(process.resourcesPath, "skills") : join(__dirname, "../../resources/skills"),
			],
		},

		customTools: [makeBrowserControlTool(), makeComponentBashTool(process.cwd())],

		dailyDir: getDailyDir(),

		featureGates: { warm: warmFeatureGates, get: () => featureGateSnapshot },
	});
	await backend.init();

	await warmFeatureGates();
	attachRendererWatchdog(backend);

	uiPluginsManager = new UiPluginManager();
	await uiPluginsManager.init();

	webBridge = new WebBridgeService({
		configPath: join(app.getPath("userData"), "web-access.json"),
		rendererDir: join(app.getAppPath(), "out", "renderer"),

		devUrl: `http://127.0.0.1:${process.env.PI_DEV_PORT || 5173}`,
		defaultPort: Number(process.env.PI_BRIDGE_PORT || 1200),
	});
	await webBridge.init();
	const bridgeStatus = webBridge.status();
	log.info("web bridge initialized", { enabled: bridgeStatus.enabled, port: bridgeStatus.port });
	registerIpc(backend, uiPluginsManager, webBridge);
	managedConfig = new ManagedConfig();
	managedConfig.setEmitter(() => sendToRenderer(IpcChannels.ManagedConfigChanged, undefined));
	managedConfig.start();

	const handleDirect = (channel: string, handler: (args: unknown) => unknown) => {
		invokeRegistry.set(channel, handler);
		ipcMain.handle(channel, (_e, args) => handler(args));
	};
	handleDirect(IpcChannels.pluginNotifyGet, () => componentNotify?.getReplay() ?? []);
	handleDirect(IpcChannels.pluginProfileGet, () => componentProfile?.getLast() ?? null);
	handleDirect(IpcChannels.componentLicensesGet, () => componentLicenses);
	const updater = new UpdateManager();
	handleDirect(IpcChannels.updateDownload, async (arg) => {
		try {
			await updater.download((arg as { url: string }).url, (p) =>
				sendToRenderer(IpcChannels.UpdateDownloadProgress, p),
			);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: (e as Error).message };
		}
	});
	handleDirect(IpcChannels.updateInstall, () => updater.install());
	handleDirect(IpcChannels.pluginCommand, (arg) => {
		const cmd = (arg as { cmd?: string } | null)?.cmd;
		if (cmd) componentRunner?.send(cmd);
	});
	app.on("will-quit", () => {
		managedConfig?.stop();
		componentProviders?.stop();
		componentRunner?.stop();
		componentNotify?.stop();
		componentProfile?.stop();
		serviceLink?.stop();
	});

	setupBrowserHardening();
	const uiState = await loadUiState();

	if (!(await componentRunner.waitReady(20000))) {
		log.error("组件未就绪，不创建窗口");
		dialog.showErrorBox(
			app.getLocale().toLowerCase().startsWith("zh") ? "无法启动" : "Cannot start",
			app.getLocale().toLowerCase().startsWith("zh")
				? "程序文件缺失，请重新安装软件。"
				: "Program files are missing. Please reinstall the application.",
		);
		app.exit(0);
		return;
	}

	nativeTheme.themeSource = uiState?.theme ?? "system";

	installSessionSecurityCsp(
		process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : null,
	);
	createWindow(resolveTheme(uiState?.theme));

	app.on("activate", () => {
		const [win] = BrowserWindow.getAllWindows();

		if (win) {
			if (win.isMinimized()) win.restore();
			win.show();
			win.focus();
			return;
		}
		createWindow(resolveTheme(uiState?.theme));
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	markQuitting();
	void webBridge?.stop();
	backend?.dispose();
	uiPluginsManager?.disposeWatcher();
});
