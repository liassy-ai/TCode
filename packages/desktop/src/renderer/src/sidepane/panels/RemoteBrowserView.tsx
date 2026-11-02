import { isAllowedBrowserUrl, normalizeBrowserUrl } from "@tcode/shared";
import { AppWindow, MonitorPlay, RotateCw, Scaling } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { AnnotateIcon, ArrowUpIcon, CloseIcon } from "../../components/icons";
import type { Translate } from "../../i18n";
import { randomUid } from "../../lib/uid";
import {
	ANNOTATION_EDIT_EVENT,
	COMPOSER_FOCUS_EVENT,
	NEW_SESSION_DRAFT_KEY,
	useDraftStore,
} from "../../stores/drafts";
import { useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { setBrowserViewport } from "../browser-control-bridge";
import {
	DEFAULT_ZOOM_VALUES,
	DESKTOP_SIZE,
	frameChoiceFor,
	useBrowserViewportStore,
	zoomValueFor,
} from "../browser-viewport";
import { useSidePaneStore } from "../store";
import { AnnotationBadge, AnnotationLayer, type AnnotationMarker } from "./annotationLayer";
import { BrowserViewportBar } from "./BrowserViewportBar";
import type { AnnotationPayload, ElementAnnotation } from "./browserAnnotate";
import {
	ABORT_PICKER_SCRIPT,
	annotationSkillCommand,
	buildPickerScript,
	candidateWorkspacePaths,
	PICKER_NEXT_SCRIPT,
	pickerPauseScript,
	sourceCandidatePaths,
} from "./browserAnnotate";

const EMBED_SPIN_MIN_MS = 1200;
const EMBED_SETTLE_MS = 450;
const LOADING_SPIN_MAX_MS = 12000;

const MIN_FRAME_SIZE = 240;
const MAX_FRAME_SIZE = 4000;

type FrameResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const KEYCODE_MAP: Record<string, string> = {
	Enter: "Enter",
	Backspace: "Backspace",
	Tab: "Tab",
	Escape: "Escape",
	Delete: "Delete",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	ArrowUp: "Up",
	ArrowDown: "Down",
	F1: "F1",
	F2: "F2",
	F3: "F3",
	F4: "F4",
	F5: "F5",
	F6: "F6",
	F7: "F7",
	F8: "F8",
	F9: "F9",
	F10: "F10",
	F11: "F11",
	F12: "F12",
};

export function RemoteBrowserView({
	startUrl,
	tabId,
	reloadTick,
	t,
}: {
	startUrl: string;
	tabId?: string;

	reloadTick?: number;
	t: Translate;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cwd = useSessionsStore((s) => s.cwd);
	const [guestId, setGuestId] = useState<string | null>(null);
	const [frame, setFrame] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	const [pageUrl, setPageUrl] = useState("");
	const dirtyRef = useRef(false);
	const [picking, setPicking] = useState(false);

	const pickEpochRef = useRef(0);
	const cardDoneRef = useRef<(() => void) | null>(null);
	const [annotation, setAnnotation] = useState<AnnotationPayload | null>(null);
	const [note, setNote] = useState("");

	const [markers, setMarkers] = useState<AnnotationMarker[]>([]);

	const [pendingNumber, setPendingNumber] = useState<number | null>(null);

	const [editingId, setEditingId] = useState<string | null>(null);

	const [frameBox, setFrameBox] = useState({ width: 0, height: 0 });

	const sizeRef = useRef({ width: 500, height: 400 });

	const [mode, setMode] = useState<"idle" | "embed" | "stream">("idle");

	const [targetUrl, setTargetUrl] = useState("");

	const [openNonce, setOpenNonce] = useState(0);

	const viewportKey = tabId ?? "remote";
	const viewportMode = useBrowserViewportStore((s) => s.modes[viewportKey] ?? "fit");
	const viewportOverride = useBrowserViewportStore((s) => s.overrides[viewportKey]);
	const manualViewport = viewportMode === "manual";
	const [viewportError, setViewportError] = useState("");
	const [embedLoading, setEmbedLoading] = useState(false);
	const embedStartRef = useRef(0);
	const embedTimerRef = useRef<number | null>(null);

	const stopEmbedTimer = useCallback(() => {
		if (embedTimerRef.current !== null) {
			window.clearTimeout(embedTimerRef.current);
			embedTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (mode !== "embed" || !targetUrl) return;
		stopEmbedTimer();
		embedStartRef.current = Date.now();
		setEmbedLoading(true);
		return stopEmbedTimer;
	}, [mode, targetUrl, openNonce, stopEmbedTimer]);

	const finishEmbedLoading = useCallback(() => {
		stopEmbedTimer();
		const elapsed = Date.now() - embedStartRef.current;
		const delay = Math.max(EMBED_SETTLE_MS, EMBED_SPIN_MIN_MS - elapsed);
		embedTimerRef.current = window.setTimeout(() => {
			embedTimerRef.current = null;
			setEmbedLoading(false);
		}, delay);
	}, [stopEmbedTimer]);

	const loading = mode === "stream" ? !frame : mode === "embed" ? embedLoading : false;

	const [loadingHint, setLoadingHint] = useState(false);
	useEffect(() => {
		if (!loading) {
			setLoadingHint(false);
			return;
		}
		setLoadingHint(true);
		const timer = window.setTimeout(() => setLoadingHint(false), LOADING_SPIN_MAX_MS);
		return () => window.clearTimeout(timer);
	}, [loading]);
	const viewportFrame = useBrowserViewportStore((s) => s.frames[viewportKey] ?? "auto");
	const viewportZoom = useBrowserViewportStore((s) => s.zoomValues[viewportKey] ?? DEFAULT_ZOOM_VALUES);
	const autoFrame = frameChoiceFor("manual", viewportFrame) === "auto";

	const stageRef = useRef<HTMLDivElement | null>(null);
	const [stage, setStage] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const sync = () => setStage({ width: el.clientWidth, height: el.clientHeight });
		sync();
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		return () => observer.disconnect();
	}, [mode, targetUrl, manualViewport]);

	const viewportSize = autoFrame
		? {
				width: Math.max(1, stage.width),
				height: Math.max(1, stage.height),
			}
		: {
				width: viewportOverride?.width ?? DESKTOP_SIZE.width,
				height: viewportOverride?.height ?? DESKTOP_SIZE.height,
			};

	const fitScale = Math.min(
		1,
		stage.width > 0 ? stage.width / viewportSize.width : 1,
		stage.height > 0 ? stage.height / viewportSize.height : 1,
	);

	const scale = Math.min(2, fitScale * zoomValueFor("manual", viewportFrame, viewportZoom));
	const autoZoom = manualViewport ? zoomValueFor("manual", viewportFrame, viewportZoom) : 1;
	const boxed = manualViewport && !autoFrame;

	const [resizingFrame, setResizingFrame] = useState(false);
	const startFrameResize = (edge: FrameResizeEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!boxed || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const ratio = scale > 0 ? scale : 1;
		const start = {
			x: event.clientX,
			y: event.clientY,
			width: viewportSize.width,
			height: viewportSize.height,
		};
		setResizingFrame(true);

		const onMove = (moveEvent: PointerEvent) => {
			const dx = (moveEvent.clientX - start.x) / ratio;
			const dy = (moveEvent.clientY - start.y) / ratio;
			let width = start.width;
			let height = start.height;
			if (edge.includes("e")) width = start.width + dx;
			if (edge.includes("w")) width = start.width - dx;
			if (edge.includes("s")) height = start.height + dy;
			if (edge.includes("n")) height = start.height - dy;
			width = Math.round(Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, width)));
			height = Math.round(Math.min(MAX_FRAME_SIZE, Math.max(MIN_FRAME_SIZE, height)));
			useBrowserViewportStore.getState().setOverride(viewportKey, { width, height, source: "user" });
		};

		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			setResizingFrame(false);
			const applied = useBrowserViewportStore.getState().overrides[viewportKey];
			if (applied) setBrowserViewport(viewportKey, { width: applied.width, height: applied.height });
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	};

	const openSeqRef = useRef(0);

	const probeCacheRef = useRef(new Map<string, boolean>());

	const probeEmbeddable = useCallback(async (url: string): Promise<boolean> => {
		const cached = probeCacheRef.current.get(url);
		if (cached !== undefined) return cached;
		try {
			const { embeddable } = await getPi().remoteBrowserProbeEmbed({ url });
			if (embeddable) probeCacheRef.current.set(url, true);
			return embeddable;
		} catch {
			return false;
		}
	}, []);

	const openUrl = async (raw: string) => {
		const target = normalizeBrowserUrl(raw);
		if (!isAllowedBrowserUrl(target)) return;
		dirtyRef.current = false;
		setDraft(target);
		const seq = ++openSeqRef.current;
		const embeddable = await probeEmbeddable(target);
		if (seq !== openSeqRef.current) return;
		setFrame(null);
		setPageUrl("");
		setTargetUrl(target);
		setOpenNonce((n) => n + 1);
		setMode(embeddable ? "embed" : "stream");
	};

	const initialUrlRef = useRef(startUrl);
	useEffect(() => {
		if (initialUrlRef.current) void openUrl(initialUrlRef.current);
	}, []);

	useEffect(() => {
		setGuestId(null);
		if (mode !== "stream" || !targetUrl) return;
		let disposed = false;
		let cleanup: (() => void) | undefined;

		const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
		const rect = containerRef.current?.getBoundingClientRect();
		const width = rect?.width ?? 500;
		const height = rect?.height ?? 400;
		sizeRef.current = { width: Math.round(width * scale), height: Math.round(height * scale) };

		void getPi()
			.remoteBrowserCreate({ url: targetUrl, width, height, scale })
			.then(({ id }) => {
				if (disposed) {
					void getPi().remoteBrowserDestroy({ id });
					return;
				}
				setGuestId(id);
				const off = getPi().onRemoteBrowserFrame((f) => {
					if (f.id === id) setFrame((prev) => (prev === f.dataUrl ? prev : f.dataUrl));
				});
				const ro = new ResizeObserver(() => {
					const r = containerRef.current?.getBoundingClientRect();
					if (!r) return;
					setFrameBox({ width: Math.round(r.width), height: Math.round(r.height) });
					sizeRef.current = { width: Math.round(r.width * scale), height: Math.round(r.height * scale) };
					void getPi().remoteBrowserResize({ id, width: r.width, height: r.height, scale });
				});
				const host = containerRef.current;
				if (host) ro.observe(host);

				const offStatus = getPi().onRemoteBrowserStatusChanged((p) => {
					if (p.id !== id || dirtyRef.current) return;
					const url = p.status.url === "about:blank" ? "" : (p.status.url ?? "");
					setPageUrl(url);
					if (p.status.url) setDraft(url);
				});
				cleanup = () => {
					off();
					offStatus();
					ro.disconnect();
					void getPi().remoteBrowserDestroy({ id });
				};
			})
			.catch((error) => console.error("[remote-browser] create failed", error));

		return () => {
			disposed = true;
			cleanup?.();
		};
	}, [mode, targetUrl, openNonce]);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		void openUrl(draft);
		const form = event.target as HTMLFormElement;
		const input = form.querySelector("input");
		if (input) {
			input.setSelectionRange(0, 0);
			input.blur();
		}
	};

	const reload = () => {
		if (mode === "idle") return;
		setFrame(null);
		setOpenNonce((n) => n + 1);
	};

	const lastReloadTickRef = useRef(reloadTick ?? 0);
	useEffect(() => {
		if (reloadTick === undefined || reloadTick === lastReloadTickRef.current) return;
		lastReloadTickRef.current = reloadTick;
		reload();
	}, [reloadTick]);

	useEffect(() => {
		if (!guestId) return;
		const apply = () => {
			void getPi()
				.remoteBrowserSetActive({ id: guestId, active: document.visibilityState === "visible" })
				.catch(() => {});
		};
		apply();
		document.addEventListener("visibilitychange", apply);
		return () => {
			document.removeEventListener("visibilitychange", apply);
			void getPi()
				.remoteBrowserSetActive({ id: guestId, active: false })
				.catch(() => {});
		};
	}, [guestId]);

	const toGuest = (clientX: number, clientY: number): { x: number; y: number } => {
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return { x: clientX, y: clientY };
		const sx = sizeRef.current.width / Math.max(1, rect.width);
		const sy = sizeRef.current.height / Math.max(1, rect.height);
		return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
	};

	const touchRef = useRef<{
		startX: number;
		startY: number;
		lastY: number;
		scrolling: boolean;
		accum: number;
	} | null>(null);

	const onTouchPointer = (event: React.PointerEvent, type: "mouseDown" | "mouseUp" | "mouseMove") => {
		if (!guestId) return;
		if (type === "mouseDown") {
			event.currentTarget.setPointerCapture(event.pointerId);
			touchRef.current = {
				startX: event.clientX,
				startY: event.clientY,
				lastY: event.clientY,
				scrolling: false,
				accum: 0,
			};
			return;
		}
		const touch = touchRef.current;
		if (!touch) return;
		if (type === "mouseMove") {
			const dx = event.clientX - touch.startX;
			const dy = event.clientY - touch.startY;
			if (!touch.scrolling && Math.abs(dx) + Math.abs(dy) > 12) touch.scrolling = true;
			if (!touch.scrolling) return;
			touch.accum += event.clientY - touch.lastY;
			touch.lastY = event.clientY;
			if (Math.abs(touch.accum) >= 150) {
				const { x, y } = toGuest(event.clientX, event.clientY);
				void getPi().remoteBrowserInput({
					id: guestId,
					event: { type: "mouseWheel", x, y, deltaY: touch.accum },
				});
				touch.accum = 0;
			}
			return;
		}

		const scrolled = touch.scrolling;
		touchRef.current = null;
		if (scrolled) return;
		const { x, y } = toGuest(event.clientX, event.clientY);
		void getPi().remoteBrowserInput({
			id: guestId,
			event: { type: "mouseDown", x, y, button: "left", clickCount: 1 },
		});
		void getPi().remoteBrowserInput({ id: guestId, event: { type: "mouseUp", x, y, button: "left" } });
	};

	const onPointer = (event: React.PointerEvent, type: "mouseDown" | "mouseUp" | "mouseMove") => {
		if (!guestId) return;
		if (event.pointerType === "touch") {
			onTouchPointer(event, type);
			return;
		}
		if (type === "mouseDown") event.currentTarget.setPointerCapture(event.pointerId);
		if (event.button !== 0 && type !== "mouseMove") return;
		const { x, y } = toGuest(event.clientX, event.clientY);
		const modifiers: string[] = [];
		if (event.shiftKey) modifiers.push("shift");
		if (event.ctrlKey) modifiers.push("control");
		if (event.altKey) modifiers.push("alt");
		if (event.metaKey) modifiers.push("meta");
		void getPi().remoteBrowserInput({
			id: guestId,
			event: { type, x, y, button: "left", clickCount: type === "mouseDown" ? 1 : undefined, modifiers },
		});
	};

	const onWheel = (event: React.WheelEvent) => {
		if (!guestId) return;
		const { x, y } = toGuest(event.clientX, event.clientY);
		void getPi().remoteBrowserInput({
			id: guestId,
			event: { type: "mouseWheel", x, y, deltaX: event.deltaX, deltaY: event.deltaY },
		});
	};

	const onKey = (event: React.KeyboardEvent) => {
		if (!guestId) return;
		event.preventDefault();
		const modifiers: string[] = [];
		if (event.shiftKey) modifiers.push("shift");
		if (event.ctrlKey) modifiers.push("ctrl");
		if (event.altKey) modifiers.push("alt");
		if (event.metaKey) modifiers.push("meta");
		const known = KEYCODE_MAP[event.key];
		if (known) {
			void getPi().remoteBrowserInput({
				id: guestId,
				event: { type: event.type === "keyup" ? "keyUp" : "keyDown", keyCode: known, modifiers },
			});
			return;
		}

		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.type !== "keyup") {
			void getPi().remoteBrowserInput({
				id: guestId,
				event: { type: "keyDown", keyCode: event.key, modifiers },
			});
			void getPi().remoteBrowserInput({ id: guestId, event: { type: "char", keyCode: event.key } });
		}
	};

	const augmentSource = useCallback(
		async (element: ElementAnnotation) => {
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
		},
		[cwd],
	);

	const augmentStyles = useCallback(
		async (element: ElementAnnotation): Promise<ElementAnnotation> => {
			if (!guestId || !cwd) return element;
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
		},
		[cwd, guestId],
	);

	const abortPicker = useCallback(() => {
		if (!guestId) return;
		void getPi()
			.remoteBrowserEvaluate({ id: guestId, code: ABORT_PICKER_SCRIPT })
			.catch(() => {});
	}, [guestId]);

	const startAnnotate = async () => {
		if (!guestId || picking) return;
		const epoch = ++pickEpochRef.current;
		setPicking(true);
		setAnnotation(null);
		setEditingId(null);
		try {
			for (let i = 0; i < 10; i++) {
				const state = (await getPi().remoteBrowserEvaluate({
					id: guestId,
					code: "document.readyState",
				})) as unknown;
				if (state === "complete") break;
				await new Promise((r) => setTimeout(r, 200));

				if (pickEpochRef.current !== epoch) return;
			}
			if (pickEpochRef.current !== epoch) return;
			await Promise.race([
				getPi().remoteBrowserEvaluate({ id: guestId, code: buildPickerScript() }),
				new Promise((resolve) => setTimeout(() => resolve("__picking_timeout__"), 15_000)),
			]);

			while (pickEpochRef.current === epoch) {
				const result = (await Promise.race([
					getPi().remoteBrowserEvaluate({ id: guestId, code: PICKER_NEXT_SCRIPT }),
					new Promise((resolve) => setTimeout(() => resolve("__picking_timeout__"), 60_000)),
				])) as ElementAnnotation | string | null;

				if (pickEpochRef.current !== epoch) return;
				if (!result || typeof result === "string") break;
				const element = await augmentStyles(result);
				if (pickEpochRef.current !== epoch) return;
				setAnnotation({ pageUrl: draft, element, note: "" });
				setPendingNumber(markers.length + 1);
				void getPi().remoteBrowserEvaluate({ id: guestId, code: pickerPauseScript(true) });
				await new Promise<void>((resolve) => {
					cardDoneRef.current = resolve;
				});
				cardDoneRef.current = null;
				if (pickEpochRef.current !== epoch) return;
				await getPi().remoteBrowserEvaluate({ id: guestId, code: pickerPauseScript(false) });
			}
		} catch (error) {
			console.error("[remote-browser] pick failed", error);
		} finally {
			if (pickEpochRef.current === epoch) {
				setPicking(false);
				abortPicker();
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

	useEffect(() => {
		const onEdit = (event: Event) => {
			const id = (event as CustomEvent<{ id?: string }>).detail?.id;
			if (!id) return;
			const marker = markers.find((m) => m.id === id);
			if (!marker) return;
			if (tabId) useSidePaneStore.getState().activateTab(tabId);
			startEdit(marker);
		};
		window.addEventListener(ANNOTATION_EDIT_EVENT, onEdit);
		return () => window.removeEventListener(ANNOTATION_EDIT_EVENT, onEdit);
	}, [markers, tabId, startEdit]);

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

	const cancel = useCallback(() => {
		pickEpochRef.current += 1;
		cardDoneRef.current?.();
		cardDoneRef.current = null;
		abortPicker();
		setPicking(false);
		setAnnotation(null);
		setNote("");
		setPendingNumber(null);
		setEditingId(null);
	}, [abortPicker]);

	const switchToEmbed = async () => {
		const target = pageUrl || targetUrl;
		if (!target || !isAllowedBrowserUrl(target)) return;
		const seq = ++openSeqRef.current;
		const embeddable = await probeEmbeddable(target);
		if (seq !== openSeqRef.current) return;
		if (!embeddable) {
			pushToast("warning", "sidepane.browser.embedBlocked");
			return;
		}
		cancel();
		setDraft(target);
		setFrame(null);
		setTargetUrl(target);
		setOpenNonce((n) => n + 1);
		setMode("embed");
	};

	const switchToStream = () => {
		if (mode !== "embed" || !targetUrl) return;
		cancel();
		setFrame(null);
		setOpenNonce((n) => n + 1);
		setMode("stream");
	};

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
			cancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [picking, annotation, cancel]);

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-surface text-ink">
			<div className="flex min-h-9 items-center gap-0.5 border-b border-border px-1.5">
				<button
					type="button"
					title={t("sidepane.browser.reload")}
					onClick={reload}
					disabled={mode === "idle"}
					className="rounded-md p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 motion-reduce:transition-none"
				>
					<RotateCw size={13} className={loadingHint ? "animate-spin" : undefined} />
				</button>
				<form onSubmit={submit} className="min-w-0 flex-1">
					<input
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							dirtyRef.current = true;
						}}
						onFocus={() => (dirtyRef.current = true)}
						aria-label={t("sidepane.browser.addressLabel")}
						placeholder={t("sidepane.browser.placeholder")}
						spellCheck={false}
						className="h-7 w-full min-w-0 rounded-full border border-border bg-canvas px-2 text-center font-mono text-[12px] text-ink outline-none focus:border-border-strong focus:text-left"
					/>
				</form>

				{mode === "embed" && targetUrl && (
					<button
						type="button"
						title={
							manualViewport ? t("sidepane.browser.windowModeFit") : t("sidepane.browser.windowModeManual")
						}
						aria-label={
							manualViewport ? t("sidepane.browser.windowModeFit") : t("sidepane.browser.windowModeManual")
						}
						aria-pressed={manualViewport}
						onClick={() => {
							setViewportError("");
							useBrowserViewportStore.getState().setMode(viewportKey, manualViewport ? "fit" : "manual");
						}}
						className={`rounded-md p-1.5 transition-colors motion-reduce:transition-none ${
							manualViewport ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
						}`}
					>
						<Scaling size={13} />
					</button>
				)}

				<button
					type="button"
					title={
						mode === "embed"
							? t("sidepane.browser.embedToStream")
							: pageUrl
								? t("sidepane.browser.annotate")
								: t("sidepane.browser.annotateNeedsPage")
					}
					disabled={mode === "idle" || (mode === "stream" && (!guestId || !pageUrl))}
					onClick={() => (mode === "embed" ? switchToStream() : void (picking ? cancel() : startAnnotate()))}
					aria-label={
						mode === "embed"
							? t("sidepane.browser.embedToStream")
							: picking
								? t("sidepane.browser.annotateCancel")
								: t("sidepane.browser.annotate")
					}
					className={`rounded-md p-1.5 transition-colors disabled:opacity-35 motion-reduce:transition-none ${
						picking ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
					}`}
				>
					{}
					{mode === "embed" ? <MonitorPlay size={13} /> : <AnnotateIcon size={13} />}
				</button>

				{mode === "stream" && (
					<button
						type="button"
						title={t("sidepane.browser.streamToEmbed")}
						onClick={() => void switchToEmbed()}
						aria-label={t("sidepane.browser.streamToEmbed")}
						className="rounded-md p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 motion-reduce:transition-none"
					>
						<AppWindow size={13} />
					</button>
				)}
			</div>

			{mode === "embed" && targetUrl && manualViewport && (
				<BrowserViewportBar
					tabId={viewportKey}
					override={viewportOverride}
					size={viewportSize}
					setError={setViewportError}
					t={t}
				/>
			)}
			{mode === "embed" && targetUrl && manualViewport && viewportError && (
				<div className="border-b border-border bg-canvas px-3 py-1 text-[11px] text-err">{viewportError}</div>
			)}

			{mode === "embed" && targetUrl ? (
				<div className="flex min-h-0 flex-1 p-0.5">
					<div
						ref={stageRef}
						className="relative flex h-full w-full items-center justify-center overflow-hidden"
					>
						<div
							className={`${boxed ? "relative shrink-0" : "relative h-full w-full"} ${resizingFrame ? "select-none" : ""}`}
							style={
								boxed
									? {
											width: viewportSize.width * scale,
											height: viewportSize.height * scale,
										}
									: undefined
							}
						>
							{}
							<iframe
								key={`${targetUrl}#${openNonce}`}
								src={targetUrl}
								title={draft || targetUrl}
								className={
									boxed
										? "absolute left-0 top-0 rounded-[10px] border border-border bg-white"
										: "rounded-[10px] bg-white"
								}
								style={
									boxed
										? {
												width: viewportSize.width,
												height: viewportSize.height,
												transform: `scale(${scale})`,
												transformOrigin: "0 0",
											}
										: {
												width: `calc(100% / ${autoZoom})`,
												height: `calc(100% / ${autoZoom})`,
												zoom: autoZoom,
											}
								}
								onLoad={finishEmbedLoading}
								allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
								allowFullScreen
							/>
							{boxed && (
								<>
									{}
									<div
										className="absolute inset-x-2 top-0 z-10 h-1.5 cursor-ns-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("n")}
									/>
									<div
										className="absolute inset-x-2 bottom-0 z-10 h-1.5 cursor-ns-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("s")}
									/>
									<div
										className="absolute inset-y-2 left-0 z-10 w-1.5 cursor-ew-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("w")}
									/>
									<div
										className="absolute inset-y-2 right-0 z-10 w-1.5 cursor-ew-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("e")}
									/>
									<div
										className="absolute left-0 top-0 z-10 h-3 w-3 -translate-x-1 -translate-y-1 cursor-nwse-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("nw")}
									/>
									<div
										className="absolute right-0 top-0 z-10 h-3 w-3 -translate-y-1 translate-x-1 cursor-nesw-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("ne")}
									/>
									<div
										className="absolute bottom-0 left-0 z-10 h-3 w-3 -translate-x-1 translate-y-1 cursor-nesw-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("sw")}
									/>
									<div
										className="absolute bottom-0 right-0 z-10 h-3 w-3 translate-x-1 translate-y-1 cursor-nwse-resize"
										style={{ touchAction: "none" }}
										onPointerDown={startFrameResize("se")}
									/>
									{resizingFrame && (
										<div className="pointer-events-none absolute -bottom-6 right-0 z-20 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-ink-dim">
											{viewportSize.width} × {viewportSize.height}
										</div>
									)}
								</>
							)}
						</div>
					</div>
				</div>
			) : mode === "stream" ? (
				<div className="relative m-0.5 min-h-0 flex-1 overflow-hidden rounded-[10px]">
					<div
						ref={containerRef}
						role="application"
						tabIndex={0}
						className="absolute inset-0 outline-none select-none"
						style={{ cursor: picking ? "crosshair" : "default", touchAction: "none" }}
						onPointerDown={(e) => onPointer(e, "mouseDown")}
						onPointerMove={(e) => onPointer(e, "mouseMove")}
						onPointerUp={(e) => onPointer(e, "mouseUp")}
						onPointerCancel={() => (touchRef.current = null)}
						onWheel={onWheel}
						onKeyDown={onKey}
						onKeyUp={onKey}
					>
						{frame ? (
							<img
								src={frame}
								alt=""
								className="pointer-events-none h-full w-full object-fill"
								draggable={false}
							/>
						) : (
							<div className="flex h-full items-center justify-center text-[12px] text-ink-faint">…</div>
						)}
					</div>
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
			) : (
				<div className="m-0.5 flex min-h-0 flex-1 items-center justify-center rounded-[10px] bg-canvas text-[12px] text-ink-faint">
					{t("sidepane.browser.embedIdleHint")}
				</div>
			)}

			{}
			{(picking || annotation) && (
				<div className="absolute inset-x-0 top-0 z-30 flex min-h-9 items-center gap-1.5 border-b border-border bg-surface px-1.5 text-[11px] text-ink-dim">
					<button
						type="button"
						onClick={cancel}
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
		</div>
	);
}
