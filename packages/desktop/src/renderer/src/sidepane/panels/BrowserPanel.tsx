import type { BrowserTabState } from "@tcode/shared";
import { BROWSER_PARTITION, isAllowedBrowserUrl, normalizeBrowserUrl } from "@tcode/shared";
import { ArrowLeft, ArrowRight, RotateCw, Scaling, Square } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { AnnotateIcon, ArrowUpIcon, CloseIcon, EyeIcon } from "../../components/icons";
import type { MessageKey } from "../../i18n";
import { randomUid } from "../../lib/uid";
import {
	ANNOTATION_EDIT_EVENT,
	COMPOSER_FOCUS_EVENT,
	NEW_SESSION_DRAFT_KEY,
	useDraftStore,
} from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import type { WebviewElement } from "../../webview";
import { clearGuestViewportEmulation, setBrowserViewport } from "../browser-control-bridge";
import { useBrowserControlNoticeStore } from "../browser-control-notice";
import { controlNoticeText } from "../browser-notice-text";
import {
	autoZoomFor,
	DEFAULT_ZOOM_VALUES,
	DESKTOP_FRAME,
	frameChoiceFor,
	frameSizeFor,
	pageZoomFor,
	useBrowserViewportStore,
} from "../browser-viewport";
import { registerBrowserWebview } from "../browser-webviews";
import type { SidePanePanelProps } from "../panelProps";
import { useSidePaneStore } from "../store";

import { AnnotationBadge, AnnotationLayer, type AnnotationMarker } from "./annotationLayer";
import { BrowserViewportBar } from "./BrowserViewportBar";
import {
	ABORT_PICKER_SCRIPT,
	type AnnotationPayload,
	annotationSkillCommand,
	buildPickerScript,
	candidateWorkspacePaths,
	type ElementAnnotation,
	PICKER_NEXT_SCRIPT,
	pickerPauseScript,
	sourceCandidatePaths,
} from "./browserAnnotate";
import { RemoteBrowserView } from "./RemoteBrowserView";

const MIN_FRAME_SIZE = 240;
const MAX_FRAME_SIZE = 4000;

type FrameResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function netFailureKey(code: number): MessageKey {
	switch (code) {
		case -102:
			return "sidepane.browser.errRefused";
		case -105:
		case -137:
			return "sidepane.browser.errDns";
		case -106:
		case -21:
			return "sidepane.browser.errOffline";
		case -7:
		case -118:
			return "sidepane.browser.errTimeout";
		case -101:
			return "sidepane.browser.errUnreachable";
		case -324:
			return "sidepane.browser.errEmpty";
		case -20:
			return "sidepane.browser.errBlocked";
		default:
			return "sidepane.browser.errNet";
	}
}

function httpFailureKey(status: number): MessageKey {
	if (status === 401 || status === 403) return "sidepane.browser.errDenied";
	if (status === 402) return "sidepane.browser.errPayment";
	if (status === 404) return "sidepane.browser.errNotFound";
	switch (status) {
		case 520:
			return "sidepane.browser.errCf520";
		case 521:
			return "sidepane.browser.errCf521";
		case 522:
			return "sidepane.browser.errCf522";
		case 523:
			return "sidepane.browser.errCf523";
		case 524:
			return "sidepane.browser.errCf524";
		case 525:
		case 526:
			return "sidepane.browser.errCfSsl";
	}
	if (status >= 500) return "sidepane.browser.errGateway";
	return "sidepane.browser.errHttp";
}

const EMPTY_STATE: BrowserTabState = {
	url: "",
	title: "",
	favicon: null,
	loading: false,
	canGoBack: false,
	canGoForward: false,
	failed: false,
	failure: null,
};

export function BrowserPanel({ tab, cwd, visible, t }: SidePanePanelProps) {
	const isElectron = typeof window.pi !== "undefined";
	const webviewRef = useRef<HTMLElement | null>(null);

	const bindWebview = useCallback(
		(el: HTMLElement | null) => {
			webviewRef.current = el;
			registerBrowserWebview(tab.id, el);
		},
		[tab.id],
	);

	const startUrl = tab.payload.url ?? "";

	const reloadTick = useSidePaneStore((s) => s.reloadTicks[tab.id] ?? 0);
	const lastReloadTickRef = useRef(reloadTick);
	useEffect(() => {
		if (reloadTick === lastReloadTickRef.current) return;
		lastReloadTickRef.current = reloadTick;

		(webviewRef.current as WebviewElement | null)?.reload();
	}, [reloadTick]);

	const controlNotice = useBrowserControlNoticeStore((s) => (s.notice?.tabId === tab.id ? s.notice : null));

	const viewportOverride = useBrowserViewportStore((s) => s.overrides[tab.id]);

	const rawFrame = useBrowserViewportStore((s) => s.frames[tab.id] ?? "auto");

	const zoomValues = useBrowserViewportStore((s) => s.zoomValues[tab.id] ?? DEFAULT_ZOOM_VALUES);

	const viewportMode = useBrowserViewportStore((s) => s.modes[tab.id] ?? "fit");

	const [viewportError, setViewportError] = useState("");

	const containerRef = useRef<HTMLDivElement | null>(null);
	const [container, setContainer] = useState({ width: 0, height: 0 });

	const frameChoice = frameChoiceFor(viewportMode, rawFrame);
	const { width: frameWidth, height: frameHeight } = frameSizeFor(viewportOverride, frameChoice, container);

	const displayZoom = autoZoomFor(container.width, container.height, frameWidth, frameHeight);

	const frameBox = {
		width: Math.round(frameWidth * displayZoom),
		height: Math.round(frameHeight * displayZoom),
	};

	const pageZoom = pageZoomFor(viewportMode, rawFrame, zoomValues);

	const centerFrame = frameChoice === DESKTOP_FRAME;

	const showViewportBar = viewportMode === "manual";

	const [resizingFrame, setResizingFrame] = useState(false);
	const startFrameResize = (edge: FrameResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!centerFrame || viewportMode !== "manual" || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const scale = displayZoom > 0 ? displayZoom : 1;
		const start = { x: event.clientX, y: event.clientY, width: frameWidth, height: frameHeight };
		setResizingFrame(true);

		const onMove = (moveEvent: PointerEvent) => {
			const dx = (moveEvent.clientX - start.x) / scale;
			const dy = (moveEvent.clientY - start.y) / scale;
			let width = start.width;
			let height = start.height;
			if (edge.includes("e")) width = start.width + dx;
			if (edge.includes("w")) width = start.width - dx;
			if (edge.includes("s")) height = start.height + dy;
			if (edge.includes("n")) height = start.height - dy;
			width = Math.round(Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, width)));
			height = Math.round(Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, height)));
			useBrowserViewportStore.getState().setOverride(tab.id, { width, height, source: "user" });
		};

		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			setResizingFrame(false);
			const applied = useBrowserViewportStore.getState().overrides[tab.id];
			if (applied) setBrowserViewport(tab.id, { width: applied.width, height: applied.height });
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	};

	const applyPageZoomRef = useRef(() => {});
	const applyPageZoom = useCallback(() => applyPageZoomRef.current(), []);
	const [state, setState] = useState<BrowserTabState>(EMPTY_STATE);
	const [draft, setDraft] = useState("");
	const [dirty, setDirty] = useState(false);
	const pendingUrlRef = useRef<string | null>(null);

	const [initialSrc] = useState("about:blank");

	const canAnnotate = state.url !== "" && state.url !== "about:blank";

	const [picking, setPicking] = useState(false);
	const [annotation, setAnnotation] = useState<AnnotationPayload | null>(null);
	const [note, setNote] = useState("");

	const [markers, setMarkers] = useState<AnnotationMarker[]>([]);

	const [pendingNumber, setPendingNumber] = useState<number | null>(null);

	const [editingId, setEditingId] = useState<string | null>(null);

	const pickEpochRef = useRef(0);
	const cardDoneRef = useRef<(() => void) | null>(null);

	const abortGuestPicker = useCallback(() => {
		const el = webviewRef.current as WebviewElement | null;
		if (!el) return;
		void el.executeJavaScript(ABORT_PICKER_SCRIPT).catch(() => {});
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			setContainer({ width: el.clientWidth, height: el.clientHeight });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const el = webviewRef.current as WebviewElement | null;
		if (!el) return;

		const refreshNav = () => {
			setState((prev) => ({ ...prev, canGoBack: el.canGoBack(), canGoForward: el.canGoForward() }));
		};
		const onDidStart = () => setState((prev) => ({ ...prev, loading: true, failed: false, failure: null }));
		const onDidStop = () => setState((prev) => ({ ...prev, loading: false }));
		const cancelPickerOnNav = () => {
			pickEpochRef.current += 1;
			setPicking(false);
			abortGuestPicker();
		};
		const onDidNavigate = (event: Event) => {
			pendingUrlRef.current = null;
			const e = event as {
				url?: string;
				httpResponseCode?: number;
				httpStatusText?: string;
			};
			const status = e.httpResponseCode ?? 0;
			setState((prev) => ({
				...prev,
				url: e.url ?? prev.url,
				failed: status >= 400,
				failure: status >= 400 ? { kind: "http", status } : null,
			}));
			refreshNav();
			cancelPickerOnNav();
		};
		const onDidNavigateInPage = (event: Event) => {
			setState((prev) => ({ ...prev, url: (event as { url?: string }).url ?? prev.url }));
			refreshNav();
			cancelPickerOnNav();
		};
		const onTitle = (event: Event) => {
			const title = (event as { title?: string }).title ?? "";
			setState((prev) => ({ ...prev, title }));

			if (title) useSidePaneStore.getState().setTabTitle(tab.id, title);
		};
		const onFavicon = (event: Event) => {
			const favicons = (event as { favicons?: string[] }).favicons;
			setState((prev) => ({ ...prev, favicon: favicons?.[0] ?? null }));
		};
		const onFail = (event: Event) => {
			const e = event as {
				errorCode?: number;
				errorDescription?: string;
				isMainFrame?: boolean;
			};
			if (!e.isMainFrame || e.errorCode === -3) return;
			const attempted = pendingUrlRef.current;
			setState((prev) => ({
				...prev,
				failed: true,
				url: attempted ?? prev.url,
				failure: {
					kind: "net",
					code: e.errorCode ?? 0,
					name: e.errorDescription ?? "",
				},
			}));
		};

		el.addEventListener("did-start-loading", onDidStart);
		el.addEventListener("did-stop-loading", onDidStop);
		el.addEventListener("did-navigate", onDidNavigate);
		el.addEventListener("did-navigate-in-page", onDidNavigateInPage);
		el.addEventListener("page-title-updated", onTitle);
		el.addEventListener("page-favicon-updated", onFavicon);
		el.addEventListener("did-fail-load", onFail);
		return () => {
			el.removeEventListener("did-start-loading", onDidStart);
			el.removeEventListener("did-stop-loading", onDidStop);
			el.removeEventListener("did-navigate", onDidNavigate);
			el.removeEventListener("did-navigate-in-page", onDidNavigateInPage);
			el.removeEventListener("page-title-updated", onTitle);
			el.removeEventListener("page-favicon-updated", onFavicon);
			el.removeEventListener("did-fail-load", onFail);
		};
	}, [abortGuestPicker, tab.id]);

	useEffect(() => {
		if (!dirty) setDraft(state.url === "about:blank" ? "" : state.url);
	}, [state.url, dirty]);

	useEffect(() => {
		const el = webviewRef.current as WebviewElement | null;
		if (!el || !startUrl) return;
		const load = () => {
			void el.loadURL(startUrl);
		};
		el.addEventListener("dom-ready", load, { once: true });
		return () => el.removeEventListener("dom-ready", load);
	}, [startUrl]);

	useEffect(() => {
		const el = webviewRef.current as WebviewElement | null;
		if (!el) return;
		const onReady = () => {
			void clearGuestViewportEmulation(tab.id).then(() => applyPageZoom());
		};
		el.addEventListener("dom-ready", onReady);
		return () => el.removeEventListener("dom-ready", onReady);
	}, [tab.id, applyPageZoom]);

	useEffect(() => {
		applyPageZoomRef.current = () => {
			const el = webviewRef.current as WebviewElement | null;
			if (!el) return;
			if (pageZoom === 1) void clearGuestViewportEmulation(tab.id);
			pushPageZoom(el, pageZoom);
		};
		applyPageZoomRef.current();
	}, [pageZoom, tab.id]);

	useEffect(() => {
		if (visible) applyPageZoom();
	}, [visible, applyPageZoom]);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const target = normalizeBrowserUrl(draft);
		if (!isAllowedBrowserUrl(target)) return;
		setDirty(false);
		setDraft(target);
		pendingUrlRef.current = target;
		void (webviewRef.current as WebviewElement | null)?.loadURL(target);
		const input = (event.target as HTMLFormElement).querySelector("input");
		if (input) {
			input.setSelectionRange(0, 0);
			input.blur();
		}
	};

	const augmentSource = async (element: ElementAnnotation) => {
		if (!cwd || !element.source) return element.source;
		const candidates = sourceCandidatePaths(element.source, cwd);
		const verifiedFiles: string[] = [];
		for (const rel of candidates) {
			try {
				await getPi().readWorkspaceFile({ cwd, path: rel, maxBytes: 1 });
				verifiedFiles.push(rel);
			} catch {}
		}
		return { ...element.source, candidateFiles: candidates, verifiedFiles };
	};

	const augmentStyles = async (element: ElementAnnotation): Promise<ElementAnnotation> => {
		const augmented = await Promise.all(
			element.styles.map(async (style) => {
				if (!style.stylesheet) return { ...style, candidateFiles: [], verifiedFiles: [] };
				const candidates = candidateWorkspacePaths(style.stylesheet, cwd);
				const verifiedFiles: string[] = [];
				for (const rel of candidates) {
					try {
						await getPi().readWorkspaceFile({ cwd, path: rel, maxBytes: 1 });
						verifiedFiles.push(rel);
					} catch {}
				}
				return { ...style, candidateFiles: candidates, verifiedFiles };
			}),
		);
		return { ...element, source: await augmentSource(element), styles: augmented };
	};

	const startAnnotate = async () => {
		const el = webviewRef.current as WebviewElement | null;
		if (!el || picking) return;
		const epoch = ++pickEpochRef.current;
		setPicking(true);
		setAnnotation(null);
		setEditingId(null);
		try {
			await el.executeJavaScript(buildPickerScript());
			while (pickEpochRef.current === epoch) {
				const result = (await el.executeJavaScript(PICKER_NEXT_SCRIPT)) as ElementAnnotation | null;
				if (pickEpochRef.current !== epoch) return;
				if (!result) break;
				const element = await augmentStyles(result);
				if (pickEpochRef.current !== epoch) return;
				setAnnotation({ pageUrl: state.url || window.location.href, element, note: "" });
				setPendingNumber(markers.length + 1);
				void el.executeJavaScript(pickerPauseScript(true));
				await new Promise<void>((resolve) => {
					cardDoneRef.current = resolve;
				});
				cardDoneRef.current = null;
				if (pickEpochRef.current !== epoch) return;
				await el.executeJavaScript(pickerPauseScript(false));
			}
		} catch (error) {
			console.error("[browser-panel] pick failed", error);
		} finally {
			if (pickEpochRef.current === epoch) {
				setPicking(false);
				abortGuestPicker();
			}
		}
	};

	const startEdit = useCallback(
		(marker: AnnotationMarker) => {
			if (picking) return;
			setEditingId(marker.id);
			setPendingNumber(null);
			setAnnotation({ pageUrl: marker.pageUrl, element: marker.element, note: marker.note });
			setNote(marker.note);
		},
		[picking],
	);

	const insertIntoComposer = () => {
		if (!annotation) return;
		const nextNote = note.trim();
		const command = annotationSkillCommand({ ...annotation, note: nextNote });
		const key = useSessionsStore.getState().activeSessionId ?? NEW_SESSION_DRAFT_KEY;
		if (editingId) {
			useDraftStore.getState().updateDraft(key, (d) => ({
				...d,
				annotations: d.annotations.map((a) => (a.id === editingId ? { ...a, command } : a)),
			}));
			setMarkers((prev) =>
				prev.map((m) =>
					m.id === editingId ? { ...m, element: annotation.element, note: nextNote, command } : m,
				),
			);
			setEditingId(null);
		} else {
			const chipId = randomUid();
			useDraftStore.getState().updateDraft(key, (d) => ({
				...d,
				annotations: [...d.annotations.filter((a) => a.command !== command), { id: chipId, command }],
			}));

			if (pendingNumber !== null) {
				setMarkers((prev) => [
					...prev,
					{
						id: chipId,
						number: pendingNumber,
						pageUrl: annotation.pageUrl,
						element: annotation.element,
						note: nextNote,
						command,
					},
				]);
				setPendingNumber(null);
			}
		}
		window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT));
		setAnnotation(null);
		setNote("");
		cardDoneRef.current?.();
	};

	const cancelAnnotate = useCallback(() => {
		pickEpochRef.current += 1;
		cardDoneRef.current?.();
		cardDoneRef.current = null;
		abortGuestPicker();
		setPicking(false);
		setAnnotation(null);
		setNote("");
		setPendingNumber(null);
		setEditingId(null);
	}, [abortGuestPicker]);

	useEffect(() => {
		const check = () => {
			const key = useSessionsStore.getState().activeSessionId ?? NEW_SESSION_DRAFT_KEY;
			const ids = new Set((useDraftStore.getState().bySession[key]?.annotations ?? []).map((a) => a.id));
			setMarkers((prev) => (prev.some((m) => !ids.has(m.id)) ? prev.filter((m) => ids.has(m.id)) : prev));
		};
		const unsub = useDraftStore.subscribe(check);
		check();
		return unsub;
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || (!picking && !annotation)) return;
			event.preventDefault();
			cancelAnnotate();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [picking, annotation, cancelAnnotate]);

	useEffect(() => {
		const onEdit = (event: Event) => {
			const id = (event as CustomEvent<{ id?: string }>).detail?.id;
			if (!id) return;
			const marker = markers.find((m) => m.id === id);
			if (!marker) return;
			useSidePaneStore.getState().activateTab(tab.id);
			startEdit(marker);
		};
		window.addEventListener(ANNOTATION_EDIT_EVENT, onEdit);
		return () => window.removeEventListener(ANNOTATION_EDIT_EVENT, onEdit);
	}, [markers, tab.id, startEdit]);

	if (!isElectron) {
		return <RemoteBrowserView startUrl={startUrl} tabId={tab.id} reloadTick={reloadTick} t={t} />;
	}

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-canvas text-ink">
			{}
			{(picking || annotation) && (
				<div className="absolute inset-x-0 top-0 z-30 flex min-h-9 items-center gap-1.5 border-b border-border bg-surface px-1.5 text-[11px] text-ink-dim">
					<button
						type="button"
						onClick={cancelAnnotate}
						title={t("sidepane.browser.annotateCancel")}
						aria-label={t("sidepane.browser.annotateCancel")}
						className="flex size-6 flex-none items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-hover hover:text-ink motion-reduce:transition-none"
					>
						<CloseIcon size={11} />
					</button>
					<span className="min-w-0 flex-1 truncate text-center">{t("sidepane.browser.annotateHint")}</span>
					<button
						type="button"
						onClick={insertIntoComposer}
						disabled={!annotation}
						title={t("sidepane.browser.annotateSend")}
						aria-label={t("sidepane.browser.annotateSend")}
						className="flex size-6 flex-none items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 motion-reduce:transition-none"
					>
						<ArrowUpIcon size={13} />
					</button>
				</div>
			)}
			<div className="flex min-h-9 items-center gap-0.5 border-b border-border px-1.5">
				<NavButton
					label={t("sidepane.browser.back")}
					disabled={!state.canGoBack}
					onClick={() => (webviewRef.current as WebviewElement | null)?.goBack()}
				>
					<ArrowLeft size={14} />
				</NavButton>
				<NavButton
					label={t("sidepane.browser.forward")}
					disabled={!state.canGoForward}
					onClick={() => (webviewRef.current as WebviewElement | null)?.goForward()}
				>
					<ArrowRight size={14} />
				</NavButton>
				<NavButton
					label={state.loading ? t("sidepane.browser.stop") : t("sidepane.browser.reload")}
					onClick={() => {
						const el = webviewRef.current as WebviewElement | null;
						if (el) {
							if (state.loading) el.stop();
							else el.reload();
						}
					}}
				>
					{state.loading ? <Square size={12} /> : <RotateCw size={13} />}
				</NavButton>
				<form onSubmit={submit} className="min-w-0 flex-1">
					<input
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							setDirty(true);
						}}
						onFocus={() => setDirty(true)}
						onBlur={() => setDirty(false)}
						aria-label={t("sidepane.browser.addressLabel")}
						placeholder={t("sidepane.browser.placeholder")}
						spellCheck={false}
						className="h-7 w-full min-w-0 rounded-full border border-border bg-canvas px-2 text-center font-mono text-[12px] text-ink outline-none focus:border-border-strong focus:text-left"
					/>
				</form>

				<NavButton
					label={
						viewportMode === "manual"
							? t("sidepane.browser.windowModeFit")
							: t("sidepane.browser.windowModeManual")
					}
					active={viewportMode === "manual"}
					onClick={() => {
						setViewportError("");
						useBrowserViewportStore.getState().setMode(tab.id, viewportMode === "manual" ? "fit" : "manual");
					}}
				>
					<Scaling size={13} />
				</NavButton>
				<NavButton
					label={picking ? t("sidepane.browser.annotateCancel") : t("sidepane.browser.annotate")}
					disabled={!canAnnotate && !picking}
					hint={t("sidepane.browser.annotateNeedsPage")}
					onClick={() => (picking ? cancelAnnotate() : void startAnnotate())}
					active={picking}
				>
					<AnnotateIcon size={13} />
				</NavButton>
			</div>

			{showViewportBar && (
				<BrowserViewportBar
					tabId={tab.id}
					override={viewportOverride}
					size={{ width: frameWidth, height: frameHeight }}
					setError={setViewportError}
					t={t}
				/>
			)}
			{showViewportBar && viewportError && (
				<div className="border-b border-border bg-canvas px-3 py-1 text-[11px] text-err">{viewportError}</div>
			)}

			<div className="relative min-h-0 flex-1 p-0.5">
				<div ref={containerRef} className="relative h-full w-full min-h-0 min-w-0">
					<div className={`h-full w-full overflow-auto ${centerFrame ? "flex flex-col" : ""}`}>
						<div
							className={`relative ${centerFrame ? "mx-auto my-auto h-fit w-fit" : ""} ${resizingFrame ? "select-none" : ""}`}
							style={{ width: frameBox.width, height: frameBox.height }}
						>
							<div
								className={`absolute left-0 top-0 origin-top-left overflow-hidden rounded-[10px] bg-canvas ${
									centerFrame ? "border border-border" : ""
								}`}
								style={{
									width: frameWidth,
									height: frameHeight,
									transform: displayZoom === 1 ? undefined : `scale(${displayZoom})`,
								}}
							>
								<webview
									ref={bindWebview}
									className="absolute -inset-px"
									src={initialSrc}
									partition={BROWSER_PARTITION}
									allowpopups
									webpreferences="sandbox=yes, contextIsolation=yes, nodeIntegration=no"
								/>
							</div>

							{centerFrame && viewportMode === "manual" && (
								<>
									{}
									<div
										className="absolute inset-x-2 top-0 z-20 h-1.5 cursor-ns-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("n")}
									/>
									<div
										className="absolute inset-x-2 bottom-0 z-20 h-1.5 cursor-ns-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("s")}
									/>
									<div
										className="absolute inset-y-2 left-0 z-20 w-1.5 cursor-ew-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("w")}
									/>
									<div
										className="absolute inset-y-2 right-0 z-20 w-1.5 cursor-ew-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("e")}
									/>
									<div
										className="absolute left-0 top-0 z-20 h-3 w-3 -translate-x-1 -translate-y-1 cursor-nwse-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("nw")}
									/>
									<div
										className="absolute right-0 top-0 z-20 h-3 w-3 -translate-y-1 translate-x-1 cursor-nesw-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("ne")}
									/>
									<div
										className="absolute bottom-0 left-0 z-20 h-3 w-3 -translate-x-1 translate-y-1 cursor-nesw-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("sw")}
									/>
									<div
										className="absolute bottom-0 right-0 z-20 h-3 w-3 translate-x-1 translate-y-1 cursor-nwse-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("se")}
									/>
									{resizingFrame && (
										<div className="pointer-events-none absolute -bottom-6 right-0 z-30 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-ink-dim">
											{frameWidth} × {frameHeight}
										</div>
									)}
								</>
							)}

							{controlNotice && (
								<div className="menu-pop pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-ink-dim shadow-pop">
									<EyeIcon size={12} />
									{controlNoticeText(t, controlNotice)}
								</div>
							)}
							{annotation && (
								<AnnotationLayer
									element={annotation.element}
									box={frameBox}
									note={note}
									onNote={setNote}
									onInsert={insertIntoComposer}
									placeholder={t("sidepane.browser.annotateNotePlaceholder")}
									insertLabel={t("sidepane.browser.annotateInsert")}
								/>
							)}
							{markers.map((m) => (
								<AnnotationBadge
									key={m.id}
									number={m.number}
									rect={m.element.rect}
									viewport={m.element.viewport}
									box={frameBox}
									onClick={() => startEdit(m)}
									label={t("sidepane.browser.annotateEdit")}
								/>
							))}
							{annotation && pendingNumber !== null && (
								<AnnotationBadge
									number={pendingNumber}
									rect={annotation.element.rect}
									viewport={annotation.element.viewport}
									box={frameBox}
								/>
							)}
						</div>
					</div>
				</div>
			</div>
			{state.failed && (
				<div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-6">
					<div className="max-w-full rounded-lg bg-surface px-4 py-3 text-center text-[12px] leading-relaxed text-ink-dim">
						<div className="text-ink-2">
							{state.failure
								? t(
										state.failure.kind === "http"
											? httpFailureKey(state.failure.status)
											: netFailureKey(state.failure.code),
									)
								: t("sidepane.browser.loadFailed")}
						</div>
						{state.failure && (
							<div className="mt-1 font-mono text-[11px] text-ink-faint">
								{state.failure.kind === "http"
									? `HTTP ${state.failure.status}`
									: `${state.failure.name || "ERR"} (${state.failure.code})`}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function pushPageZoom(el: WebviewElement, factor: number): void {
	try {
		const pending = el.setZoomFactor(factor) as unknown as Promise<void> | undefined;
		if (pending && typeof pending.catch === "function") void pending.catch(() => {});
	} catch {}
}

function NavButton({
	label,
	disabled,
	hint,
	active,
	onClick,
	children,
}: {
	label: string;
	disabled?: boolean;

	hint?: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={disabled && hint ? hint : label}
			disabled={disabled}
			onClick={onClick}
			className={`rounded-md p-1.5 transition-colors motion-reduce:transition-none ${
				active ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
			} disabled:opacity-35 disabled:hover:bg-transparent`}
		>
			{children}
		</button>
	);
}
