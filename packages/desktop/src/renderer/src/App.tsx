import type { TrustRequest } from "@tcode/shared";
import { useCallback, useEffect, useState } from "react";
import { getPi } from "./api";
import { EmptyState } from "./components/chat/EmptyState";
import { MessageList } from "./components/chat/MessageList";
import { RecallConfirm } from "./components/chat/RecallConfirm";
import { TodoPanel } from "./components/chat/TodoPanel";
import { PluginGiftHost } from "./components/PluginGiftHost";
import { PluginNotifyHost } from "./components/PluginNotifyHost";
import { ServiceNotice } from "./components/ServiceNotice";
import { DockSlot } from "./components/session/DockSlot";
import { SessionRail } from "./components/session/SessionRail";
import { SessionTabBar } from "./components/session/SessionTabBar";
import { TrustDialog } from "./components/session/TrustDialog";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Toaster } from "./components/Toaster";
import { useCheckpointSnapshots } from "./hooks/use-checkpoint-snapshots";
import { usePaneArbitration } from "./hooks/use-pane-arbitration";
import { useSessionEventBridge } from "./hooks/use-session-event-bridge";
import { LanguageScope } from "./i18n";
import { initDailyDir } from "./lib/daily";
import { startUiStateSync } from "./lib/ui-state-sync";
import { randomUid } from "./lib/uid";
import { useSessionGc } from "./lib/use-session-gc";
import { initUiPlugins } from "./plugins/loader";
import { RegionHost } from "./plugins/RegionHost";
import { Slot } from "./plugins/Slot";
import { UI_REGIONS, UI_SLOTS } from "./plugins/slots";
import { initBrowserControlBridge } from "./sidepane/browser-control-bridge";
import { SidePaneDock } from "./sidepane/SidePaneDock";
import { dockTakesSlack, useSidePaneStore } from "./sidepane/store";
import { finishSplash } from "./splash";
import { initAppQuit } from "./stores/app-quit";
import { useChatLayoutStore } from "./stores/chat-layout";
import { useProjectsStore } from "./stores/projects";
import { restoreSessionWorkspace } from "./stores/session-workspace-restore";
import { useSessionsStore } from "./stores/sessions";
import { bootstrapSettings, useSettingsStore } from "./stores/settings";
import { backgroundImageUrl, useThemeStore } from "./stores/theme";
import { useTranscriptStore } from "./stores/transcript";
import { useUiPreferencesStore } from "./stores/ui-preferences";

export default function App() {
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	const showEmpty = useTranscriptStore((s) => {
		const entry = activeSessionId ? s.bySession[activeSessionId] : undefined;
		return !entry || (entry.messages.length === 0 && !entry.streaming);
	});
	const [trustRequests, setTrustRequests] = useState<TrustRequest[]>([]);

	useEffect(() => {
		const off = getPi().onManagedConfigChanged(() => {
			void useSettingsStore.getState().refresh();

			void useSessionsStore.getState().loadModels();
		});
		return off;
	}, []);

	const pushTrustRequest = useCallback((req: TrustRequest) => {
		setTrustRequests((prev) => [...prev, req]);
	}, []);
	useSessionEventBridge({ onTrustRequest: pushTrustRequest });

	useEffect(() => {
		return getPi().onSessionsChanged(() => {
			if (!useProjectsStore.getState().loaded) return;
			void useProjectsStore.getState().load();
		});
	}, []);

	useEffect(() => {
		return getPi().onSidePaneOpenBrowserTab(({ url }) => {
			let title = url;
			try {
				title = new URL(url).hostname;
			} catch {}
			useSidePaneStore.getState().openTab({
				kind: "browser",
				discriminator: randomUid(),
				title,
				payload: { url },
			});
		});
	}, []);

	useSessionGc();

	useCheckpointSnapshots();

	usePaneArbitration();
	const chatFloorPx = useChatLayoutStore((s) => s.floorPx);
	const dockSlack = useSidePaneStore(dockTakesSlack);
	const sidePaneChatWidthPx = useSidePaneStore((s) => s.chatWidthPx);

	const chatPinPx = dockSlack ? sidePaneChatWidthPx : null;

	useEffect(() => {
		bootstrapSettings();

		void useProjectsStore.getState().load();

		const stopUiStateSync = startUiStateSync();

		const lastCwd = useUiPreferencesStore.getState().lastCwd;
		useSessionsStore.getState().activateNewSessionDraft(lastCwd ?? undefined);

		void Promise.allSettled([useSessionsStore.getState().loadModels()]).then(() => finishSplash());

		void restoreSessionWorkspace();

		initAppQuit();

		void initDailyDir();

		void initUiPlugins();

		const stopBrowserControlBridge = initBrowserControlBridge();
		return () => {
			stopBrowserControlBridge();
			stopUiStateSync();
		};
	}, []);

	const respondTrust = (requestId: string, optionIndex: number) => {
		void getPi().respondTrust({ requestId, answer: optionIndex });
		setTrustRequests((prev) => prev.filter((req) => req.id !== requestId));
	};

	const bgImage = useThemeStore((s) => s.background.image);
	const bgDim = useThemeStore((s) => s.background.dim);

	return (
		<div className="relative h-full">
			{bgImage && (
				<>
					<div className="app-bg" style={{ backgroundImage: `url("${backgroundImageUrl(bgImage)}")` }} />
					<div className="app-bg-scrim" style={{ opacity: bgDim }} />
				</>
			)}

			<RegionHost region={UI_REGIONS.AppBackground} />
			<div className="relative z-10 flex h-full flex-col">
				<SessionTabBar />

				<div className="relative flex min-h-0 flex-1">
					<Sidebar />

					<div
						data-chat-col
						className="relative flex min-w-0 flex-1 flex-col"
						style={{
							minWidth: chatFloorPx || undefined,

							flexGrow: chatPinPx === null ? undefined : 1,
							flexBasis: chatPinPx === null ? undefined : chatPinPx + "px",
							flexShrink: chatPinPx === null ? undefined : 999,
						}}
					>
						<SessionRail />

						<LanguageScope>
							<main className="relative min-h-0 flex-1">
								{showEmpty ? <EmptyState /> : <MessageList />}
								<Slot name={UI_SLOTS.TodoPanel} props={{}} fallback={TodoPanel} />

								<RegionHost region={UI_REGIONS.CornerTopLeft} />
								<RegionHost region={UI_REGIONS.CornerTopRight} />
								<RegionHost region={UI_REGIONS.CornerBottomLeft} />
								<RegionHost region={UI_REGIONS.CornerBottomRight} />
							</main>
							<DockSlot sessionId={activeSessionId} hideComposer={showEmpty} />
						</LanguageScope>
					</div>

					<SidePaneDock />
				</div>
			</div>

			<RegionHost region={UI_REGIONS.AppOverlay} />
			<SettingsDialog />
			<TrustDialog requests={trustRequests} onRespond={respondTrust} />
			<PluginNotifyHost />
			<PluginGiftHost />
			<ServiceNotice />
			<Toaster />
			<RecallConfirm />
		</div>
	);
}
